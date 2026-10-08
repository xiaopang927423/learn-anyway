// ============================================================
// WordMate macOS 服务菜单原生插件（Objective-C++ / N-API）
// 作用：向系统注册一个「服务」（Service），让用户在任何软件里选中文字，
//       右键 →「服务」→「用 WordMate 翻译」，把选中的字符串回传给 JS 主进程。
//
// macOS 的「服务」不是通过 JS 能注册的，必须：
//   1) App 的 Info.plist 里声明 NSServices（见 package.json → build.mac.extendInfo）
//      其中 NSPortName = "WordMate" 必须与本文件 NSRegisterServicesProvider 的端口名一致；
//      NSMessage = "wordmateTranslate"，系统会追加 :userData:error: 构造选择器。
//   2) 运行期调用 NSRegisterServicesProvider(provider, name) 注册一个 provider 对象。
//
// 触发时系统在主线程的 Cocoa 运行循环里回调 provider 的方法；我们不直接调 JS
// （V8 上下文此刻未必安全），而是通过 N-API 线程安全函数把文本投递给 Node 事件循环。
// ============================================================
#include <node_api.h>
#include <string>

#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>

// ---- provider：被系统回调的对象，方法选择器必须与 Info.plist 的 NSMessage 对应 ----
@interface WordMateServiceProvider : NSObject
- (void)wordmateTranslate:(NSPasteboard *)pboard
                 userData:(NSString *)userData
                    error:(NSString **)error;
@end

// 前向声明：把 UTF-8 文本投给 Node
static void PostTextToNode(const std::string &text);

static WordMateServiceProvider *g_provider = nil;   // 常驻，别释放
static napi_threadsafe_function g_tsfn = nullptr;

@implementation WordMateServiceProvider
// 系统选中文本 → 命中这个服务时，macOS 用 (NSPasteboard, userData, error) 三参数回调本方法。
- (void)wordmateTranslate:(NSPasteboard *)pboard
                 userData:(NSString *)userData
                    error:(NSString **)error {
  NSString *text = nil;
  if (pboard != nil) {
    text = [pboard stringForType:NSPasteboardTypeString];
    if (text.length == 0) {
      // 少数来源只给旧式纯文本类型，兜底再读一次
      text = [pboard stringForType:@"NSStringPboardType"];
    }
  }
  if (text.length > 0) {
    PostTextToNode(std::string([text UTF8String]));
  }
  if (error != NULL) *error = nil;  // 不向系统报错
}
@end

// ---- N-API 胶水 ----

// 线程安全函数的执行体：在 Node 主线程事件循环里被调用，真正去跑 JS 回调。
static void CallJs(napi_env env, napi_value js_cb, void *context, void *data) {
  if (env == nullptr) {          // 环境销毁（进程退出）：data 若存在需回收
    delete static_cast<std::string *>(data);
    return;
  }
  auto *payload = static_cast<std::string *>(data);
  napi_value arg = nullptr;
  napi_status st = napi_create_string_utf8(
      env, payload ? payload->c_str() : "",
      payload ? payload->size() : 0, &arg);
  napi_value undefined = nullptr;
  napi_get_undefined(env, &undefined);
  if (st == napi_ok) {
    napi_call_function(env, undefined, js_cb, 1, &arg, nullptr);
  }
  delete payload;
}

static void PostTextToNode(const std::string &text) {
  if (g_tsfn == nullptr) return;
  auto *copy = new std::string(text);
  if (napi_call_threadsafe_function(g_tsfn, copy, napi_tsfn_nonblocking) != napi_ok) {
    delete copy;  // 投递失败（如队列关闭），别泄漏
  }
}

// init(cb)：注册服务、保存 JS 回调。仅应在主进程启动时调用一次。
static napi_value Init(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1] = {nullptr};
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 1) {
    napi_throw_error(env, nullptr, "wordmate_services.init 需要一个回调函数");
    return nullptr;
  }

  napi_value async_name = nullptr;
  napi_create_string_utf8(env, "wordmate-services", NAPI_AUTO_LENGTH, &async_name);

  if (g_tsfn == nullptr) {
    napi_status st = napi_create_threadsafe_function(
        env, args[0], nullptr, async_name,
        /*max_queue_size=*/0, /*initial_thread_count=*/1,
        nullptr, nullptr, nullptr, CallJs, &g_tsfn);
    if (st != napi_ok || g_tsfn == nullptr) {
      napi_throw_error(env, nullptr, "napi_create_threadsafe_function 失败");
      return nullptr;
    }
    // 主线程常驻：ref 引用计数由 JS 侧持有；这里不 unref，否则事件循环可能退出后收不到服务。
  }

  if (g_provider == nil) {
    g_provider = [[WordMateServiceProvider alloc] init];
  }
  // 端口名 "WordMate" 必须与 Info.plist 里 NSServices 的 NSPortName 完全一致。
  NSRegisterServicesProvider(g_provider, @"WordMate");
  NSUpdateDynamicServices();

  napi_value result = nullptr;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value Unregister(napi_env env, napi_callback_info info) {
  if (g_provider != nil) {
    NSUnregisterServicesProvider(@"WordMate");
    g_provider = nil;
  }
  if (g_tsfn != nullptr) {
    napi_release_threadsafe_function(g_tsfn, napi_tsfn_release);
    g_tsfn = nullptr;
  }
  napi_value result = nullptr;
  napi_get_undefined(env, &result);
  return result;
}

// 先读辅助功能选区，尽可能不碰剪贴板。
static napi_value SelectedText(napi_env env, napi_callback_info info) {
  NSString *text = @"";
  if (AXIsProcessTrusted()) {
    AXUIElementRef system = AXUIElementCreateSystemWide();
    CFTypeRef focused = nullptr;
    if (AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute, &focused) == kAXErrorSuccess && focused) {
      CFTypeRef value = nullptr;
      if (AXUIElementCopyAttributeValue((AXUIElementRef)focused, kAXSelectedTextAttribute, &value) == kAXErrorSuccess && value) {
        if (CFGetTypeID(value) == CFStringGetTypeID()) text = [(__bridge NSString *)value copy];
        CFRelease(value);
      }
      CFRelease(focused);
    }
    CFRelease(system);
  }
  napi_value result;
  napi_create_string_utf8(env, text.UTF8String, NAPI_AUTO_LENGTH, &result);
  return result;
}
static NSArray<NSPasteboardItem *> *g_savedItems = nil;
static NSInteger g_markerChange = -1;
static napi_value BeginCapture(napi_env env, napi_callback_info info) {
  NSPasteboard *board = NSPasteboard.generalPasteboard;
  NSInteger before = board.changeCount;
  if (g_savedItems != nil) { napi_throw_error(env, nullptr, "已有划词操作正在进行"); return nullptr; }
  NSMutableArray *items = [NSMutableArray array];
  NSUInteger total = 0;
  for (NSPasteboardItem *original in board.pasteboardItems) {
    NSPasteboardItem *copy = [[NSPasteboardItem alloc] init];
    for (NSString *type in original.types) {
      NSData *data = [original dataForType:type];
      total += data.length;
      if (total > 32 * 1024 * 1024) { napi_throw_error(env, nullptr, "剪贴板内容过大，请使用系统服务或浏览器右键翻译"); return nullptr; }
      if (data) [copy setData:data forType:type];
    }
    [items addObject:copy];
  }
  if (board.changeCount != before) { napi_throw_error(env, nullptr, "剪贴板已变化，请重试"); return nullptr; }
  g_savedItems = [items copy];
  [board clearContents];
  [board setString:@"WordMate-selection-pending" forType:NSPasteboardTypeString];
  g_markerChange = board.changeCount;
  napi_value result; napi_get_undefined(env, &result); return result;
}
static napi_value EndCapture(napi_env env, napi_callback_info info) {
  NSPasteboard *board = NSPasteboard.generalPasteboard;
  NSInteger count = board.changeCount;
  NSString *text = @"";
  // 一次复制应只改变一次；额外变化来自并发复制，保留最新内容且不查错选区。
  if (g_savedItems != nil && count == g_markerChange + 1) text = [board stringForType:NSPasteboardTypeString] ?: @"";
  if (g_savedItems != nil && count <= g_markerChange + 1) {
    [board clearContents];
    if (g_savedItems.count) [board writeObjects:g_savedItems];
  }
  g_savedItems = nil; g_markerChange = -1;
  napi_value result; napi_create_string_utf8(env, text.UTF8String, NAPI_AUTO_LENGTH, &result); return result;
}

static napi_value Register(napi_env env, napi_value exports) {
  napi_value init_fn = nullptr, unreg_fn = nullptr;
  napi_create_function(env, "init", NAPI_AUTO_LENGTH, Init, nullptr, &init_fn);
  napi_create_function(env, "unregister", NAPI_AUTO_LENGTH, Unregister, nullptr, &unreg_fn);
  napi_set_named_property(env, exports, "init", init_fn);
  napi_set_named_property(env, exports, "unregister", unreg_fn);
  napi_value selected, begin, end;
  napi_create_function(env, "selectedText", NAPI_AUTO_LENGTH, SelectedText, nullptr, &selected);
  napi_create_function(env, "beginCapture", NAPI_AUTO_LENGTH, BeginCapture, nullptr, &begin);
  napi_create_function(env, "endCapture", NAPI_AUTO_LENGTH, EndCapture, nullptr, &end);
  napi_set_named_property(env, exports, "selectedText", selected);
  napi_set_named_property(env, exports, "beginCapture", begin);
  napi_set_named_property(env, exports, "endCapture", end);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Register)
