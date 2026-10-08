{
  "targets": [
    {
      "target_name": "wordmate_services",
      "sources": [ "wordmate_services.mm" ],
      "product_extension": "node",
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "cflags": [ "-fobjc-arc", "-Wno-deprecated-declarations" ],
      "libraries": [ "-framework Cocoa", "-framework ApplicationServices" ],
      "xcode_settings": {
        "CLANG_ENABLE_OBJC_ARC": "YES",
        "MACOSX_DEPLOYMENT_TARGET": "11.0",
        "OTHER_CFLAGS": [ "-fobjc-arc", "-Wno-deprecated-declarations" ],
        "OTHER_LDFLAGS": [ "-framework", "Cocoa", "-framework", "ApplicationServices" ]
      }
    }
  ]
}
