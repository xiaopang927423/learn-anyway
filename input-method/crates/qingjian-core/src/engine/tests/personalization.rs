//! Explicit choices must survive structural ranking and automatic sentence insertion.
use super::*;

fn choose(engine: &mut Engine, input: &str, text: &str) {
    engine.set_input(input);
    let candidate = engine
        .query()
        .unwrap()
        .candidates
        .items
        .into_iter()
        .find(|c| c.text == text)
        .unwrap();
    engine.commit(&candidate);
    engine.break_chain();
}

#[test]
fn selected_completion_beats_the_default_full_last_syllable() {
    let mut engine = engine().with_learner(Box::new(CountingLearner(HashMap::new())));
    choose(&mut engine, "kaifa", "开放");
    for input in ["kaifa", "kai'fa"] {
        engine.set_input(input);
        assert_eq!(texts_of(&engine)[0], "开放", "{input}");
    }
    // A prefix choice must not displace a candidate that covers a longer input.
    engine.set_input("kaifazhe");
    assert_eq!(texts_of(&engine)[0], "开发者");
}

#[test]
fn selected_reading_beats_the_default_segmentation() {
    let mut engine = engine().with_learner(Box::new(CountingLearner(HashMap::new())));
    choose(&mut engine, "xian", "西安");
    engine.set_input("xian");
    assert_eq!(texts_of(&engine)[0], "西安");
}

#[test]
fn shuangpin_choices_use_decoded_input_and_follow_changed_preferences() {
    let mut engine = xiaohe().with_learner(Box::new(CountingLearner(HashMap::new())));
    engine.set_input("kdf");
    assert_eq!(texts_of(&engine)[0], "开放");
    choose(&mut engine, "kdf", "开发");
    engine.set_input("kdf");
    assert_eq!(texts_of(&engine)[0], "开发");
    assert_eq!(engine.learner().choice_weight("kaif", "开发"), 1);
    for _ in 0..2 {
        choose(&mut engine, "kdf", "开放");
    }
    engine.set_input("kdf");
    assert_eq!(texts_of(&engine)[0], "开放");
}

#[test]
fn automatic_sentence_does_not_jump_ahead_of_a_personal_choice() {
    let dictionary =
        Dictionary::parse("你\tni\t100000\n好\thao\t100000\n拟好\tni hao\t1\n").unwrap();
    let mut engine =
        Engine::new(dictionary).with_learner(Box::new(CountingLearner(HashMap::new())));
    engine.set_input("nihao");
    assert_eq!(texts_of(&engine)[0], "你好");
    choose(&mut engine, "nihao", "拟好");
    engine.set_input("nihao");
    assert_eq!(texts_of(&engine)[0], "拟好");
}

#[test]
fn personal_choice_survives_a_large_pool_with_other_global_favorites() {
    let mut source = String::new();
    let mut counts = HashMap::new();
    for i in 0..2100 {
        let word = format!("候选{i}");
        source.push_str(&format!("{word}\tkai fang\t{}\n", 100000 - i));
        counts.insert(word, 100);
    }
    source.push_str("开放\tkai fang\t1\n");
    counts.insert("开放".into(), 1);
    counts.insert("kf\t开放".into(), 1);
    let mut engine = Engine::new(Dictionary::parse(&source).unwrap())
        .with_learner(Box::new(CountingLearner(counts)));
    engine.set_input("kf");
    assert_eq!(texts_of(&engine)[0], "开放");
}

#[test]
fn staged_name_parts_keep_the_original_input_buffer_for_learning() {
    let dictionary = Dictionary::parse("张\tzhang\t100\n宇\tyu\t100\n萱\txuan\t100\n").unwrap();
    let mut engine = Engine::new(dictionary).with_learner(Box::new(WordLearner::default()));
    for _ in 0..2 {
        engine.break_chain();
        engine.set_input("zhangyuxuan");
        for text in ["张", "宇", "萱"] {
            let candidate = engine
                .query()
                .unwrap()
                .candidates
                .items
                .into_iter()
                .find(|c| c.text == text)
                .unwrap();
            let (_, keys) = engine.stage_candidate(&candidate).unwrap();
            let remaining = engine.composition().typed_text();
            engine.commit_staged(&[(candidate, keys)], text);
            engine.set_input(&remaining);
        }
    }
    assert_eq!(engine.learner().choice_weight("zhangyuxuan", "张宇萱"), 2);
    engine.set_input("zhangyuxuan");
    assert_eq!(texts_of(&engine)[0], "张宇萱");
}

#[test]
fn a_name_chosen_with_full_pinyin_is_prioritized_with_initials() {
    let dictionary =
        Dictionary::parse("张宇萱\tzhang yu xuan\t1\n这一下\tzhe yi xia\t90000\n").unwrap();
    let mut engine =
        Engine::new(dictionary).with_learner(Box::new(CountingLearner(HashMap::new())));
    choose(&mut engine, "zhangyuxuan", "张宇萱");
    engine.set_input("zyx");
    assert_eq!(texts_of(&engine)[0], "张宇萱");
}

#[test]
fn a_sentence_from_a_different_segmentation_does_not_hide_an_exact_word() {
    let dictionary =
        Dictionary::parse("济南\tji nan\t100\n金\tjin\t90000\n安\tan\t90000\n").unwrap();
    let mut engine =
        Engine::new(dictionary).with_learner(Box::new(CountingLearner(HashMap::new())));
    engine.set_input("jinan");
    assert_eq!(texts_of(&engine)[0], "济南");
    choose(&mut engine, "jinan", "济南");
    engine.set_input("jin'an");
    let query = engine.query().unwrap();
    assert_eq!(query.candidates.items[0].text, "金安", "{query:?}");
}

#[test]
fn raw_draft_parts_do_not_consume_later_candidate_keys_or_the_suffix() {
    let dictionary = Dictionary::parse("张\tzhang\t100\n宇\tyu\t100\n").unwrap();
    let mut engine =
        Engine::new(dictionary).with_learner(Box::new(CountingLearner(HashMap::new())));
    engine.set_input("zhangyu");
    let candidate = engine
        .query()
        .unwrap()
        .candidates
        .items
        .into_iter()
        .find(|c| c.text == "张")
        .unwrap();
    let (_, keys) = engine.stage_candidate(&candidate).unwrap();
    let raw = Candidate {
        text: " ".into(),
        kind: CandidateKind::Generated,
        syllables: Vec::new(),
        reading: None,
        translation: None,
        aux_code: None,
    };
    engine.commit_staged(&[(raw, String::new()), (candidate, keys)], " 张");
    assert_eq!(engine.composition().text(), "yu");
    assert_eq!(engine.learner().choice_weight("zhang", "张"), 1);
}
