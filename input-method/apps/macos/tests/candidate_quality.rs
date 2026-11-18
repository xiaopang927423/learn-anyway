//! Offline checks against the shipped resources, never the user's learning files.
use qingjian_core::Engine;
use qingjian_dictionary::Dictionary;
use qingjian_lm::BigramModel;
use std::path::Path;

#[test]
#[ignore = "requires the locally installed, manifest-verified dictionary and language model"]
fn offline_candidate_quality() {
    let resources = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../resources");
    let mut engine = Engine::new(Dictionary::open_qj(&resources.join("dict.qj")).unwrap())
        .with_language_model(Box::new(
            BigramModel::from_path(&resources.join("lm.qj")).unwrap(),
        ));
    let samples = [
        ("nihao", "你好"),
        ("xiexie", "谢谢"),
        ("mingtian", "明天"),
        ("jintian", "今天"),
        ("huiyi", "会议"),
        ("gongzuo", "工作"),
        ("kaifa", "开发"),
        ("ceshi", "测试"),
        ("shurufa", "输入法"),
        ("jineng", "技能"),
        ("xian", "先"),
        ("xianyang", "咸阳"),
        ("zhangwei", "张伟"),
        ("wangxiaoming", "王小明"),
        ("woxiangqubeijing", "我想去北京"),
        ("jintianxiawu", "今天下午"),
        ("wozaigongzuo", "我在工作"),
        ("mingtianjian", "明天见"),
        ("xuexiyingyu", "学习英语"),
        ("chongqing", "重庆"),
        ("zhongguo", "中国"),
        ("renming", "任命"),
        ("xiangmu", "项目"),
        ("sheji", "设计"),
        ("yonghu", "用户"),
        ("shujuku", "数据库"),
        ("woaini", "我爱你"),
        ("qingbangwo", "请帮我"),
        ("zaiyici", "再一次"),
        ("ziran", "自然"),
        ("shanghai", "上海"),
        ("jinan", "济南"),
        ("fangan", "方案"),
        ("tiananmen", "天安门"),
        ("jin'an", "金安"),
        ("ji'nan", "济南"),
    ];
    for (input, expected) in samples {
        engine.set_input(input);
        let query = engine.query().unwrap();
        let first = &query.candidates.items[0];
        assert_eq!(
            first.text,
            expected,
            "{input}: {:?}",
            query
                .candidates
                .items
                .iter()
                .take(5)
                .map(|c| &c.text)
                .collect::<Vec<_>>()
        );
        assert_eq!(first.syllables.concat(), input.replace('\'', ""), "{input}");
    }
    println!(
        "IME_CANDIDATE_QUALITY_OK {} fixed offline samples",
        samples.len()
    );
}
