use super::*;

fn candidate(text: &str) -> Candidate {
    Candidate {
        text: text.to_owned(),
        kind: qingjian_core::CandidateKind::Chinese,
        syllables: Vec::new(),
        reading: None,
        translation: None,
        aux_code: None,
    }
}

#[test]
fn records_and_round_trips_through_tsv() {
    let mut learner = FrequencyLearner::default();
    learner.record(&candidate("开发"));
    learner.record(&candidate("开发"));
    learner.record(&candidate("中文"));
    assert_eq!(learner.weight("开发"), 2);
    assert!(learner.is_dirty());

    let dir = std::env::temp_dir().join(format!("qingjian-learning-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("user.tsv");
    learner.save_to(&path).unwrap();
    assert!(!learner.is_dirty());

    let mut restored = FrequencyLearner::from_path(&path).unwrap();
    assert_eq!(restored.weight("开发"), 2);
    assert_eq!(restored.weight("中文"), 1);
    assert_eq!(restored.weight("没有"), 0);

    // flush 写回加载时的路径
    restored.record(&candidate("中文"));
    restored.flush();
    assert_eq!(
        FrequencyLearner::from_path(&path).unwrap().weight("中文"),
        2
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn choices_are_keyed_by_input_and_round_trip() {
    let dir = std::env::temp_dir().join("qingjian-user-choices-test");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("user.tsv");
    let _ = std::fs::remove_file(dir.join(USER_CHOICES_FILE));

    let mut learner = FrequencyLearner::from_path(&path).unwrap();
    learner.record_choice("ba", "吧");
    learner.record_choice("ba", "吧");
    learner.record_choice("bazhege", "把");
    learner.record_raw("nihooma");
    assert_eq!(learner.raw_count("nihooma"), 1);
    assert_eq!(learner.choice_weight("ba", "吧"), 2);
    assert_eq!(learner.choice_weight("ba", "把"), 0);
    assert_eq!(learner.choice_weight("bazhege", "把"), 1);
    learner.flush();

    let reloaded = FrequencyLearner::from_path(&path).unwrap();
    assert_eq!(reloaded.choice_count(), 3);
    assert_eq!(reloaded.choice_weight("ba", "吧"), 2);
    assert_eq!(reloaded.raw_count("nihooma"), 1);
    assert_eq!(reloaded.choice_weight("bazhege", "把"), 1);
}

#[test]
fn unrecord_reverses_each_kind_of_record() {
    let mut learner = FrequencyLearner::default();
    let candidate = Candidate {
        text: "开放".into(),
        kind: qingjian_core::CandidateKind::Chinese,
        syllables: vec!["kai".into(), "fang".into()],
        reading: None,
        translation: None,
        aux_code: None,
    };
    learner.record(&candidate);
    learner.record_choice("kaifa", "开放");
    learner.record_transition(Context::START, "开放", 2);
    learner.unrecord("开放");
    learner.unrecord_choice("kaifa", "开放");
    learner.unrecord_transition(Context::START, "开放", 2);
    assert_eq!(learner.weight("开放"), 0);
    assert_eq!(learner.choice_weight("kaifa", "开放"), 0);
    assert_eq!(learner.choice_count(), 0);
    assert!(learner.user_ngram().is_none());
    // 没记过的撤销不会变成负数
    learner.unrecord("没有");
    learner.unrecord_choice("x", "没有");
    assert_eq!(learner.weight("没有"), 0);
}

#[test]
fn choices_decay_when_over_the_cap() {
    let mut learner = FrequencyLearner::default();
    learner.record_choice("a", "甲");
    learner.record_choice("a", "甲");
    learner.record_choice("a", "甲");
    learner.record_choice("a", "乙");
    learner.decay_choices();
    assert_eq!(learner.choice_weight("a", "甲"), 1);
    assert_eq!(learner.choice_weight("a", "乙"), 0);
    assert_eq!(learner.choice_count(), 1);
}

#[test]
fn transitions_round_trip_through_ngram_tsv() {
    let dir = std::env::temp_dir().join("qingjian-user-ngram-test");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("user.tsv");
    let _ = std::fs::remove_file(dir.join(USER_NGRAM_FILE));

    let mut learner = FrequencyLearner::from_path(&path).unwrap();
    assert!(learner.user_ngram().is_none());
    learner.record_transition(Context::START, "我", 1);
    learner.record_transition(Context::after("我"), "想", 1);
    learner.record_transition(Context::after("我"), "想", 1);
    learner.record_transition(Context::after_two("我", "想"), "去", 1);
    assert_eq!(learner.user_ngram().unwrap().pair(Some("我"), "想"), 2);
    learner.flush();

    let reloaded = FrequencyLearner::from_path(&path).unwrap();
    // 二元 <s>我 / 我想 / 想去，三元 <s>我想 / 我想去
    assert_eq!(reloaded.ngram_transition_count(), 5);
    assert_eq!(reloaded.user_ngram().unwrap().pair(None, "我"), 1);
    assert_eq!(reloaded.user_ngram().unwrap().count("想"), 2);
    assert_eq!(
        reloaded
            .user_ngram()
            .unwrap()
            .triple(Some("我"), "想", "去"),
        1
    );
}

#[test]
fn typos_round_trip_and_unrecord() {
    let dir = std::env::temp_dir().join("qingjian-user-typos-test");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("user.tsv");
    let _ = std::fs::remove_file(dir.join(USER_TYPOS_FILE));

    let mut learner = FrequencyLearner::from_path(&path).unwrap();
    learner.record_typo("gan", "guan");
    learner.record_typo("gan", "guan");
    learner.record_typo("shou", "shuo");
    learner.unrecord_typo("shou", "shuo");
    learner.unrecord_typo("mei", "you");
    assert_eq!(learner.typo_count("gan", "guan"), 2);
    assert_eq!(learner.typo_count("shou", "shuo"), 0);
    assert_eq!(learner.typo_count_total(), 1);
    learner.flush();

    let reloaded = FrequencyLearner::from_path(&path).unwrap();
    assert_eq!(reloaded.typo_count("gan", "guan"), 2);
    assert_eq!(reloaded.typo_count_total(), 1);
}

#[test]
fn broken_lines_are_skipped_instead_of_failing_the_load() {
    let dir = std::env::temp_dir().join("qingjian-broken-lines-test");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("user.tsv");
    std::fs::write(&path, "开发\t3\n没有次数\n中文\tabc\n中文\t1\n").unwrap();
    std::fs::write(dir.join(USER_NGRAM_FILE), "<s>\t我\t3\n坏行\n我\t想\t2\n").unwrap();
    std::fs::write(dir.join(USER_CHOICES_FILE), "ba\t吧\t2\nba\n").unwrap();
    std::fs::write(dir.join(USER_TYPOS_FILE), "gan\tguan\tx\ngan\tguan\t1\n").unwrap();
    std::fs::write(dir.join(USER_WORDS_FILE), "账套\tzhang tao\t100\n只有词\n").unwrap();
    // 编码坏掉的字节也不能让整个文件读不了
    std::fs::write(dir.join(USER_ENGLISH_FILE), b"gist\t2\n\xff\xfe\t1\n").unwrap();

    let learner = FrequencyLearner::from_path(&path).unwrap();
    assert_eq!(learner.weight("开发"), 3);
    assert_eq!(learner.weight("中文"), 1);
    assert_eq!(learner.user_ngram().unwrap().pair(Some("我"), "想"), 2);
    assert_eq!(learner.choice_weight("ba", "吧"), 2);
    assert_eq!(learner.typo_count("gan", "guan"), 1);
    assert_eq!(learner.word_count(), 1);
    assert_eq!(learner.english_count(), 2);
    assert!(learner.path.is_some());
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn saving_is_atomic_and_leaves_no_temporary_files() {
    let dir = std::env::temp_dir().join("qingjian-atomic-save-test");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("user.tsv");
    let mut learner = FrequencyLearner::from_path(&path).unwrap();
    learner.record(&candidate("开发"));
    learner.record_choice("kaifa", "开发");
    learner.record_transition(Context::START, "开发", 1);
    learner.record_typo("gan", "guan");
    learner.learn_word("账套", &["zhang".into(), "tao".into()]);
    learner.learn_english("gist");
    assert!(learner.has_unsaved());
    learner.flush();
    assert!(!learner.has_unsaved());
    let names: Vec<String> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names.len(), 7, "{names:?}");
    assert!(names.iter().all(|name| !name.contains(".tmp")), "{names:?}");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn missing_file_is_empty_table() {
    let learner = FrequencyLearner::from_path("/nonexistent/qingjian-user.tsv").unwrap();
    assert!(learner.is_empty());
}

#[test]
fn forget_removes_the_user_word_and_every_trace_of_learning() {
    let mut learner = FrequencyLearner::default();
    learner.learn_word("账套", &["zhang".into(), "tao".into()]);
    learner.record(&candidate("账套"));
    learner.record_choice("zhangtao", "账套");
    learner.record_choice("zt", "账套");
    learner.record_choice("zt", "周天");
    learner.record_transition(Context::START, "账套", 1);
    learner.record_transition(Context::after("账套"), "建好", 1);
    let forgotten = learner.forget("账套");
    assert!(forgotten.user_word && forgotten.learning);
    assert!(learner.user_words().is_none());
    assert_eq!(learner.weight("账套"), 0);
    assert_eq!(learner.choice_weight("zt", "账套"), 0);
    assert_eq!(learner.choice_weight("zt", "周天"), 1);
    assert!(learner.user_ngram().is_none());
    // 词库词、没学过：什么都没清
    assert!(learner.forget("开发").is_nothing());
    // 只学过、不是用户词
    learner.record(&candidate("开发"));
    let forgotten = learner.forget("开发");
    assert!(!forgotten.user_word && forgotten.learning);
    // 个人英文词
    learner.learn_english("gist");
    assert!(learner.forget_english("Gist"));
    assert!(!learner.forget_english("gist"));
    assert!(learner.user_english().is_none());
}

#[test]
fn user_words_round_trip_through_tsv_and_form_a_dictionary() {
    let dir = std::env::temp_dir().join("qingjian-user-words-test");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("user.tsv");
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(dir.join(USER_WORDS_FILE));

    let mut learner = FrequencyLearner::from_path(&path).unwrap();
    assert!(learner.user_words().is_none());
    learner.learn_word("账套", &["zhang".to_owned(), "tao".to_owned()]);
    learner.learn_word("账套", &["zhang".to_owned(), "tao".to_owned()]);
    assert_eq!(learner.word_count(), 1);
    let hits = learner
        .user_words()
        .unwrap()
        .lookup(&["zhang", "tao"], false);
    assert_eq!(hits[0].text, "账套");
    learner.flush();

    let reloaded = FrequencyLearner::from_path(&path).unwrap();
    assert_eq!(reloaded.word_count(), 1);
    let hits = reloaded.user_words().unwrap().lookup(&["zhang"], true);
    assert_eq!(hits[0].text, "账套");
}

#[test]
fn english_words_round_trip_through_tsv_and_form_a_word_list() {
    let dir = std::env::temp_dir().join("qingjian-user-english-test");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("user.tsv");
    let _ = std::fs::remove_file(FrequencyLearner::english_path(&path));
    let mut learner = FrequencyLearner::from_path(&path).unwrap();
    assert!(learner.user_english().is_none());
    learner.learn_english("gist");
    learner.learn_english("Gist");
    learner.learn_english("python");
    assert_eq!(learner.english_count(), 2);
    // 第一次敲的写法留下，次数合并
    assert_eq!(learner.user_english().unwrap().get("gist"), Some("gist"));
    assert_eq!(learner.user_english().unwrap().complete("g", 3), ["gist"]);
    learner.flush();
    let reloaded = FrequencyLearner::from_path(&path).unwrap();
    assert_eq!(reloaded.english_count(), 2);
    assert_eq!(
        reloaded.user_english().unwrap().get("python"),
        Some("python")
    );
    let saved = std::fs::read_to_string(FrequencyLearner::english_path(&path)).unwrap();
    assert!(saved.contains("gist\t2"));
}

#[test]
fn confirmed_phrase_survives_reload_and_participates_in_candidates() {
    use qingjian_core::{CandidateKind, Engine};
    let dir = std::env::temp_dir().join(format!(
        "wordmate-confirmed-phrase-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("user.tsv");
    let dictionary = || Dictionary::parse("星\txing\t100\n河\the\t100\n").unwrap();
    let mut engine = Engine::new(dictionary())
        .with_learner(Box::new(FrequencyLearner::from_path(&path).unwrap()));
    let parts: Vec<_> = [("星", "xing"), ("河", "he")]
        .into_iter()
        .map(|(text, key)| {
            (
                Candidate {
                    text: text.into(),
                    kind: CandidateKind::Chinese,
                    syllables: vec![key.into()],
                    reading: None,
                    translation: None,
                    aux_code: None,
                },
                key.into(),
            )
        })
        .collect();
    engine.remember_confirmed_phrase(&parts, "星河");
    engine.flush_learning();
    let restored = FrequencyLearner::from_path(&path).unwrap();
    assert_eq!(restored.choice_weight("xinghe", "星河"), 1);
    assert_eq!(
        restored
            .user_words()
            .unwrap()
            .lookup(&["xing", "he"], false)[0]
            .text,
        "星河"
    );
    let mut reopened = Engine::new(dictionary()).with_learner(Box::new(restored));
    reopened.set_input("xinghe");
    assert!(
        reopened
            .query()
            .unwrap()
            .candidates
            .items
            .iter()
            .any(|c| c.text == "星河")
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn bilingual_common_words_survive_reload_and_literal_english_improves_ranking() {
    use qingjian_core::{CandidateKind, Engine};
    let dir = std::env::temp_dir().join(format!(
        "wordmate-bilingual-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("user.tsv");
    let dict = || Dictionary::parse("星\txing\t100\n河\the\t100\n").unwrap();
    let english = || WordList::parse("company\tcompany\t900\ncompass\tcompass\t10\n").unwrap();
    let mut engine = Engine::new(dict())
        .with_english(english())
        .with_learner(Box::new(FrequencyLearner::from_path(&path).unwrap()));
    engine.set_english_mode(true);
    for _ in 0..5 {
        engine.set_input("compass");
        assert_eq!(engine.take_raw(), "compass");
    }
    engine.set_input("comp");
    assert_eq!(engine.query().unwrap().candidates.items[0].text, "compass");
    engine.set_english_mode(false);
    engine.set_input("xinghe");
    let candidate = Candidate {
        text: "星河".into(),
        kind: CandidateKind::Cloud,
        syllables: vec!["xing".into(), "he".into()],
        reading: None,
        translation: None,
        aux_code: None,
    };
    assert!(
        engine.learner().user_words().is_none(),
        "preview must not learn"
    );
    engine.commit(&candidate);
    engine.flush_learning();
    let restored = FrequencyLearner::from_path(&path).unwrap();
    assert_eq!(restored.english_weight("COMPASS"), 5);
    assert_eq!(restored.weight("星河"), 1);
    let mut reopened = Engine::new(dict())
        .with_english(english())
        .with_learner(Box::new(restored));
    reopened.set_input("xinghe");
    assert!(
        reopened
            .query()
            .unwrap()
            .candidates
            .items
            .iter()
            .any(|c| c.text == "星河")
    );
    reopened.set_english_mode(true);
    reopened.set_input("comp");
    assert_eq!(
        reopened.query().unwrap().candidates.items[0].text,
        "compass"
    );
    reopened.set_learning(false);
    reopened.set_input("compass");
    reopened.take_raw();
    assert_eq!(reopened.learner().english_weight("compass"), 5);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn confirmed_cloud_phrase_keeps_validated_readings_after_reload() {
    use qingjian_core::{CandidateKind, Engine};
    let dir = std::env::temp_dir().join(format!(
        "wordmate-cloud-readings-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let dictionary = || Dictionary::parse("我\two\t100\n的\tde\t100\n书\tshu\t100\n").unwrap();
    for (name, input, model_reading, suffix, expected) in [
        ("corrected", "wode", "wo di", false, Some("wo de")),
        ("shifted", "WoDe", "wo di", false, Some("wo de")),
        ("combined", "wode", "wo di", true, Some("wo de shu")),
        ("fallback", "wdoe", "wo de", false, Some("wo de")),
        ("rejected", "wodi", "wo ni", true, None),
    ] {
        let path = dir.join(name).join("user.tsv");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut engine = Engine::new(dictionary())
            .with_learner(Box::new(FrequencyLearner::from_path(&path).unwrap()));
        let cloud = Candidate {
            text: "我的".into(),
            kind: CandidateKind::Cloud,
            syllables: model_reading
                .split_whitespace()
                .map(str::to_owned)
                .collect(),
            reading: None,
            translation: None,
            aux_code: None,
        };
        let output = if suffix { "我的书" } else { "我的" };
        for _ in 0..3 {
            engine.break_chain();
            engine.set_input(input);
            let (_, keys) = engine.stage_candidate(&cloud).unwrap();
            let mut parts = vec![(cloud.clone(), keys)];
            if suffix {
                engine.set_input("shu");
                let book = engine.query().unwrap().candidates.items[0].clone();
                let (_, keys) = engine.stage_candidate(&book).unwrap();
                parts.push((book, keys));
            }
            engine.commit_staged(&parts, output);
            // The live composition has been drained. Each part must use its saved keys.
            assert!(engine.composition().is_empty());
            engine.remember_confirmed_phrase(&parts, output);
        }
        engine.flush_learning();
        let restored = FrequencyLearner::from_path(&path).unwrap();
        match expected {
            Some(reading) => {
                assert_eq!(
                    restored.words.get(output).map(String::as_str),
                    Some(reading),
                    "{name}"
                );
                let mut reopened = Engine::new(dictionary()).with_learner(Box::new(restored));
                reopened.set_input(&reading.replace(' ', ""));
                assert!(
                    reopened
                        .query()
                        .unwrap()
                        .candidates
                        .items
                        .iter()
                        .any(|c| c.text == output),
                    "{name}"
                );
            }
            None => assert!(
                !restored.words.contains_key(output),
                "unverified cloud reading must not form a phrase"
            ),
        }
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn confirmed_candidate_preference_survives_reload_and_respects_learning_switches() {
    use qingjian_core::Engine;
    let dir = std::env::temp_dir().join(format!(
        "wordmate-preference-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("user.tsv");
    let reopen = || {
        Engine::new(Dictionary::parse("开发\tkai fa\t9000\n开放\tkai fang\t1\n").unwrap())
            .with_learner(Box::new(FrequencyLearner::from_path(&path).unwrap()))
    };
    let confirm = |engine: &mut Engine, text: &str| {
        engine.set_input("kaifa");
        let candidate = engine
            .query()
            .unwrap()
            .candidates
            .items
            .into_iter()
            .find(|c| c.text == text)
            .unwrap();
        let before = engine.learner().choice_weight("kaifa", text);
        let (_, keys) = engine.stage_candidate(&candidate).unwrap();
        assert_eq!(
            engine.learner().choice_weight("kaifa", text),
            before,
            "previewing a choice must not learn before host confirmation"
        );
        let parts = vec![(candidate, keys)];
        engine.commit_staged(&parts, text);
        engine.remember_confirmed_phrase(&parts, text);
        engine.break_chain();
    };
    let first = |engine: &mut Engine| {
        engine.set_input("kaifa");
        engine.query().unwrap().candidates.items[0].text.clone()
    };
    let mut engine = reopen();
    assert_eq!(first(&mut engine), "开发");
    confirm(&mut engine, "开放");
    assert_eq!(first(&mut engine), "开放");
    engine.flush_learning();
    let mut restored = reopen();
    assert_eq!(first(&mut restored), "开放");
    restored.set_learning(false);
    confirm(&mut restored, "开发");
    restored.set_learning(true);
    restored.set_private(true);
    confirm(&mut restored, "开发");
    restored.set_private(false);
    assert_eq!(restored.learner().choice_weight("kaifa", "开发"), 0);
    assert_eq!(first(&mut restored), "开放");
    for _ in 0..2 {
        confirm(&mut restored, "开发");
    }
    assert_eq!(first(&mut restored), "开发");
    restored.flush_learning();
    assert_eq!(first(&mut reopen()), "开发");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn split_names_are_learned_in_full_and_recalled_by_initials_after_reload() {
    use qingjian_core::{Engine, shuangpin::Scheme};
    let dir = std::env::temp_dir().join(format!(
        "wordmate-name-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    for (name, keys, scheme) in [
        ("pinyin", "zhangyuxuan", None),
        ("shuangpin", "vhyuxr", Some(Scheme::Xiaohe)),
        ("initials", "zyx", None),
    ] {
        let path = dir.join(name).join("user.tsv");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let dictionary = || {
            Dictionary::parse(
                "张\tzhang\t100\n宇\tyu\t100\n萱\txuan\t100\n这一下\tzhe yi xia\t90000\n",
            )
            .unwrap()
        };
        let mut engine = Engine::new(dictionary())
            .with_learner(Box::new(FrequencyLearner::from_path(&path).unwrap()));
        engine.set_shuangpin(scheme);
        for _ in 0..2 {
            engine.break_chain();
            engine.set_input(keys);
            for text in ["张", "宇", "萱"] {
                let candidate = engine
                    .query()
                    .unwrap()
                    .candidates
                    .items
                    .into_iter()
                    .find(|c| c.text == text)
                    .unwrap();
                let (_, part_keys) = engine.stage_candidate(&candidate).unwrap();
                let remaining = engine.composition().typed_text();
                engine.commit_staged(&[(candidate, part_keys)], text);
                assert_eq!(engine.composition().typed_text(), remaining);
                engine.set_input(&remaining);
            }
        }
        assert_eq!(
            engine.learner().choice_weight("zhangyuxuan", "张宇萱"),
            2,
            "{name}"
        );
        engine.flush_learning();
        let mut reopened = Engine::new(dictionary())
            .with_learner(Box::new(FrequencyLearner::from_path(&path).unwrap()));
        for input in ["zhangyuxuan", "zhang'yu'xuan", "zyx", "zhangyx"] {
            reopened.set_input(input);
            assert_eq!(
                reopened.query().unwrap().candidates.items[0].text,
                "张宇萱",
                "{name}: {input}"
            );
        }
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn confirmed_shuangpin_phrase_records_decoded_full_reading() {
    use qingjian_core::{Engine, shuangpin::Scheme};
    let mut engine = Engine::new(Dictionary::parse("星\txing\t100\n河\the\t100\n").unwrap())
        .with_learner(Box::new(FrequencyLearner::default()));
    engine.set_shuangpin(Some(Scheme::Xiaohe));
    engine.set_input("xkhe");
    let mut parts = Vec::new();
    for text in ["星", "河"] {
        let candidate = engine
            .query()
            .unwrap()
            .candidates
            .items
            .into_iter()
            .find(|c| c.text == text)
            .unwrap();
        let (_, keys) = engine.stage_candidate(&candidate).unwrap();
        parts.push((candidate, keys));
    }
    engine.commit_staged(&parts, "星河");
    engine.remember_confirmed_phrase(&parts, "星河");
    assert_eq!(engine.learner().choice_weight("xinghe", "星河"), 1);
    assert_eq!(engine.learner().choice_weight("xkhe", "星河"), 0);
}

#[test]
fn replacing_an_abbreviated_name_retracts_its_full_reading_preference() {
    use qingjian_core::Engine;
    let mut engine = Engine::new(
        Dictionary::parse("张宇萱\tzhang yu xuan\t1\n张宇轩\tzhang yu xuan\t9000\n").unwrap(),
    )
    .with_learner(Box::new(FrequencyLearner::default()));
    engine.set_input("zyx");
    let candidate = engine
        .query()
        .unwrap()
        .candidates
        .items
        .into_iter()
        .find(|c| c.text == "张宇萱")
        .unwrap();
    let (_, keys) = engine.stage_candidate(&candidate).unwrap();
    let parts = vec![(candidate, keys)];
    engine.commit_staged(&parts, "张宇萱");
    engine.remember_confirmed_phrase(&parts, "张宇萱");
    assert_eq!(engine.learner().choice_weight("zhangyuxuan", "张宇萱"), 1);
    for _ in 0..3 {
        engine.note_backspace();
    }
    engine.set_input("zyx");
    let replacement = engine
        .query()
        .unwrap()
        .candidates
        .items
        .into_iter()
        .find(|c| c.text == "张宇轩")
        .unwrap();
    engine.commit(&replacement);
    assert_eq!(engine.learner().choice_weight("zyx", "张宇萱"), 0);
    assert_eq!(engine.learner().choice_weight("zhangyuxuan", "张宇萱"), 0);
}

#[test]
fn recent_habits_overtake_old_counts_and_survive_restart() {
    use qingjian_core::Engine;
    let dir = std::env::temp_dir().join(format!("wordmate-recent-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("user.tsv");
    let mut learner = FrequencyLearner::from_path(&path).unwrap();
    for _ in 0..1000 {
        learner.record_choice("xinghe", "星河");
    }
    for _ in 0..10 {
        learner.record_choice("xinghe", "星禾");
    }
    assert_eq!(learner.choice_weight("xinghe", "星河"), 1000);
    assert!(
        learner.preference_weight("xinghe", "星禾") > learner.preference_weight("xinghe", "星河")
    );
    learner.flush();
    let reopened = FrequencyLearner::from_path(&path).unwrap();
    assert_eq!(
        reopened.preference_weight("xinghe", "星禾"),
        learner.preference_weight("xinghe", "星禾")
    );
    let mut engine =
        Engine::new(Dictionary::parse("星河\txing he\t90000\n星禾\txing he\t1\n").unwrap())
            .with_learner(Box::new(reopened));
    engine.set_input("xinghe");
    assert_eq!(engine.query().unwrap().candidates.items[0].text, "星禾");
    engine.set_extra_dictionaries(vec![Dictionary::parse("星河\txing he\t999999\n").unwrap()]);
    engine.set_input("xinghe");
    assert_eq!(engine.query().unwrap().candidates.items[0].text, "星禾");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn undo_and_forget_remove_recent_preferences() {
    let mut learner = FrequencyLearner::default();
    learner.record_choice("xinghe", "星河");
    let before = learner.preference_weight("xinghe", "星河");
    learner.record_choice("xinghe", "星河");
    learner.unrecord_choice("xinghe", "星河");
    assert_eq!(learner.preference_weight("xinghe", "星河"), before);
    learner.forget("星河");
    assert_eq!(learner.preference_weight("xinghe", "星河"), 0);
    assert!(learner.recent.is_empty());
}
