//! 翻译选中文字、译词键与删候选键。

use super::*;

impl WordMateInputController {
    pub(crate) fn accept_wordmate(&self, client: TextClient<'_>, chinese: bool) -> bool {
        if chinese {
            return self.commit_source(client);
        }
        let source_is_english = host::with(|h| {
            let source = format!(
                "{}{}",
                h.assistant.draft_text(),
                h.session
                    .candidate(h.session.highlighted)
                    .map(|c| c.text)
                    .unwrap_or_default()
            );
            h.assistant.has_draft() && !source.is_empty() && source.is_ascii()
        })
        .unwrap_or(false);
        if source_is_english {
            return self.commit_source(client);
        }
        // Already-English candidates need no model round trip or translation.
        let english = host::with(|h| {
            (!h.assistant.has_draft()
                && h.assistant.target != "en"
                && !h.engine.composition().is_empty()
                && h.session
                    .candidate(h.session.highlighted)
                    .is_some_and(|c| c.kind == qingjian_core::CandidateKind::English))
            .then_some(h.session.highlighted)
        })
        .flatten();
        if let Some(index) = english {
            return self.commit_index(index, client);
        }
        let snapshot = host::with(|h| {
            if !h.is_composing() || h.assistant.committing {
                return None;
            }
            Some((
                h.session.candidate(h.session.highlighted),
                h.assistant.text.clone()?,
                h.assistant.meaning.clone(),
                h.assistant.generation,
            ))
        })
        .flatten();
        let Some((candidate, text, meaning, generation)) = snapshot else {
            host::with(|h| h.status = Some("译文正在准备；可继续选字或用原文快捷键确认".into()));
            return true;
        };
        let active = host::with(|h| {
            h.assistant.generation == generation
                && h.active_input
                    .as_ref()
                    .is_some_and(|(_, object)| &**object as *const _ == client.object_ptr())
        })
        .unwrap_or(false);
        if !active {
            return true;
        }
        let output = host::with(|h| {
            if text.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
                && h.assistant
                    .context
                    .chars()
                    .last()
                    .is_some_and(|c| c.is_ascii_alphanumeric())
            {
                format!(" {text}")
            } else {
                text.clone()
            }
        })
        .unwrap_or_else(|| text.clone());
        let (owned, cursor) = host::with(|h| {
            let draft = h.assistant.draft_text();
            let query = h.engine.query().ok();
            if !h.preedit_mode.inline() && draft.is_empty() {
                return (String::new(), 0);
            }
            let cursor = h.assistant.draft_cursor.unwrap_or_else(|| {
                draft.chars().count()
                    + query
                        .as_ref()
                        .map(|query| query.marked_cursor())
                        .unwrap_or(0)
            });
            (
                format!(
                    "{}{}",
                    draft,
                    query.map(|query| query.marked_text()).unwrap_or_default()
                ),
                cursor,
            )
        })
        .unwrap_or_default();
        let parts = host::with(|h| {
            if h.assistant.generation != generation || h.assistant.committing {
                return None;
            }
            if !h.engine.composition().is_empty() {
                let candidate = candidate?;
                let (text, keys) = h.engine.stage_candidate(&candidate)?;
                h.assistant.draft.push(crate::wordmate::DraftWord {
                    candidate,
                    keys,
                    text,
                });
            }
            let parts = h.assistant.draft.clone();
            let remaining = h.engine.composition().typed_text();
            let choices: Vec<_> = parts
                .iter()
                .map(|word| (word.candidate.clone(), word.keys.clone()))
                .collect();
            h.engine.commit_staged(&choices, &output);
            h.engine.set_input(&remaining);
            h.assistant.draft.clear();
            h.assistant.draft_cursor = None;
            h.assistant.committing = true;
            Some(parts)
        })
        .flatten();
        let Some(parts) = parts else {
            return true;
        };
        let confirmed = client.insert_composition_verified(&output, &owned, cursor);
        host::with(|h| {
            if h.assistant.generation != generation {
                return;
            }
            h.assistant.note_text(&output);
            if confirmed {
                let source: String = parts.iter().map(|part| part.text.as_str()).collect();
                if let Some((fragment, original)) =
                    crate::sentence_edit::learning_fragment(&source, &text)
                {
                    h.assistant.learn(&fragment, &original, "fragment");
                } else if parts.len() <= 1
                    && source.chars().all(|c| !c.is_ascii_alphabetic())
                    && meaning.chars().count() <= 8
                    && text.split_whitespace().count() <= 8
                {
                    h.assistant.learn(&text, &meaning, "fragment");
                } else {
                    let words = format!(
                        " {} ",
                        text.to_ascii_lowercase()
                            .split(|c: char| !c.is_ascii_alphabetic() && c != '\'')
                            .filter(|s| !s.is_empty())
                            .collect::<Vec<_>>()
                            .join(" ")
                    );
                    let mut learned = std::collections::HashSet::new();
                    for part in &parts {
                        if let Some(translation) = &part.candidate.translation {
                            for sense in translation.senses() {
                                let key = sense.text.to_ascii_lowercase();
                                if key.len() >= 3
                                    && words.contains(&format!(" {key} "))
                                    && learned.insert(key)
                                {
                                    h.assistant.learn(&sense.text, &part.text, "fragment");
                                }
                            }
                        }
                    }
                }
            }
            h.assistant.invalidate(false);
        });
        self.refresh(client);
        true
    }

    /// Explicit whole-composition translation; the reference engine supplies the sentence.
    pub(crate) fn translate_composition(&self, client: TextClient<'_>) -> bool {
        let snapshot = host::with(|h| {
            let draft = h.assistant.draft_text();
            let query = h.engine.query().ok();
            let expected = format!(
                "{}{}",
                draft,
                query
                    .as_ref()
                    .map(|query| query.marked_text())
                    .unwrap_or_default()
            );
            let candidate = h
                .session
                .candidate(h.session.highlighted)
                .or_else(|| query.and_then(|query| query.candidates.items.into_iter().next()));
            let source = format!(
                "{}{}",
                draft,
                candidate
                    .as_ref()
                    .map(|candidate| candidate.text.as_str())
                    .unwrap_or_default()
            );
            (!source.is_empty()).then_some((source, candidate, expected))
        })
        .flatten();
        let Some((source, candidate, expected)) = snapshot else {
            return false;
        };
        let range = client
            .insertion_range()
            .unwrap_or(objc2_foundation::NSRange::new(
                objc2_foundation::NSNotFound as usize,
                0,
            ));
        let anchor = client.caret_rect();
        host::with(|h| {
            h.anchor = anchor;
            h.assistant.invalidate(false);
            h.assistant.observe(&source, None, true);
            h.begin_translation(range, &source);
            if let Some(job) = &mut h.translation {
                job.composition = true;
                job.expected = expected;
                job.source = source;
                job.source_candidate = candidate;
            }
        });
        true
    }

    /// Option+数字：上屏当前页第几个候选的译文（学习和拼音消耗与选那个候选一样）。
    /// 不在组句中时不管；候选没有译文就吞掉按键不动，免得 ¡™£ 进应用。
    /// 翻译应用里选中的文字：云服务关着、密码框、没有选区都不动（键交回应用）。
    pub(super) fn translate_selection(&self, client: TextClient<'_>) -> bool {
        if secure_input::enabled() {
            tracing::debug!("Secure Input 中，不翻译");
            return false;
        }
        let Some((text, range)) = client.selected_text(MAX_TRANSLATE_CHARS) else {
            // 分不清是没选还是应用不给读（不少 Electron 应用不支持），两种情况都提示一下，键吞掉
            tracing::debug!("没有选中的文字，或应用不支持读选区");
            let anchor = client.caret_rect();
            host::with(|h| {
                h.show_notice(
                    "没有选中的文字，或这个应用不支持读取选区（最多 1000 字）",
                    anchor,
                )
            });
            return true;
        };
        // 光标位置先在借用之外取好：取的过程会等应用回话，期间别的 IMK 回调可能重入
        let anchor = client.caret_rect();
        host::with(|h| {
            h.anchor = anchor;
            h.assistant.invalidate(false);
            h.assistant.observe(&text, None, true);
            h.begin_translation(range, &text);
            if let Some(job) = &mut h.translation {
                job.expected = text.clone();
                job.source = text;
                job.generation = h.assistant.generation;
            }
        });
        true
    }

    /// Explicit translation review: Space / 1 accepts, Escape cancels; Return is consumed.
    pub(crate) fn handle_translation_review(&self, key: u16, client: TextClient<'_>) -> bool {
        let job = host::with(|h| h.translation.clone()).flatten();
        let Some(job) = job else {
            return false;
        };
        match key {
            // Do not adopt or forward Return while a translation is being reviewed.
            36 | 76 => {
                host::with(|h| {
                    h.status = Some(format!(
                        "请点译文或按 {} 采用；Esc 取消",
                        h.settings.config().shortcut.input_keys().1.label()
                    ));
                    h.render();
                });
                true
            }
            49 | 18 => {
                if let Some(result) = job.result {
                    tracing::debug!("接受译文");
                    let valid_range = if job.composition {
                        host::with(|h| h.is_composing()).unwrap_or(false)
                    } else {
                        client
                            .selected_text(MAX_TRANSLATE_CHARS)
                            .is_some_and(|(text, range)| text == job.source && range == job.range)
                    };
                    if !valid_range
                        || !host::with(|h| h.assistant.generation == job.generation)
                            .unwrap_or(false)
                    {
                        host::with(|h| h.end_translation());
                        if job.composition {
                            self.refresh(client);
                        }
                        host::with(|h| {
                            h.assistant.fallback = Some(result);
                            h.render();
                        });
                        return true;
                    }
                    if job.composition {
                        host::with(|h| h.end_translation());
                        // Restore the original candidate snapshot rather than the presentation-only sentence.
                        host::with(|h| {
                            if let Some(candidate) = job.source_candidate.clone() {
                                h.session.reset(None, vec![candidate], h.page_size, 0);
                            }
                            h.assistant.text = Some(result.clone());
                            h.assistant.meaning = job.source.clone();
                        });
                        return self.accept_wordmate(client, false);
                    }
                    let confirmed = client.replace_range_verified(&result, job.range);
                    host::with(|h| {
                        h.end_translation();
                        if confirmed {
                            if let Some((fragment, original)) =
                                crate::sentence_edit::learning_fragment(&job.source, &result)
                            {
                                h.assistant.learn(&fragment, &original, "annotation");
                            }
                        } else if !confirmed {
                            h.assistant.status = "无法确认上屏，请检查原文；未加入生词本".into();
                            h.assistant.fallback = Some(result);
                            h.render();
                        }
                    });
                }
                true
            }
            // Esc：放弃
            53 => {
                host::with(|h| h.end_translation());
                if job.composition {
                    self.refresh(client);
                }
                true
            }
            _ => {
                host::with(|h| h.end_translation());
                if job.composition {
                    self.refresh(client);
                }
                false
            }
        }
    }

    pub(super) fn handle_translation_key(
        &self,
        digit: usize,
        sense: usize,
        client: TextClient<'_>,
    ) -> bool {
        let composing = host::with(|h| h.is_composing()).unwrap_or(false);
        if !composing {
            return false;
        }
        let candidate = host::with(|h| {
            h.session
                .index_on_page(digit - 1)
                .and_then(|index| h.session.candidate(index))
        })
        .flatten();
        let Some(candidate) = candidate else {
            return true;
        };
        let Some(text) = candidate
            .translation
            .as_ref()
            .and_then(|translation| translation.senses().get(sense))
            .map(|sense| sense.text.clone())
        else {
            return true;
        };
        let draft = host::with(|h| h.assistant.has_draft()).unwrap_or(false);
        if draft {
            if host::with(|h| h.engine.composition().is_empty()).unwrap_or(false) {
                host::with(|h| {
                    h.assistant.text = Some(text);
                    h.assistant.meaning = h.assistant.draft_text();
                });
                return self.accept_wordmate(client, false);
            }
            host::with(|h| {
                if let Some((_, keys)) = h.engine.stage_candidate(&candidate) {
                    let output = if h
                        .assistant
                        .draft_text()
                        .chars()
                        .last()
                        .is_some_and(|c| c.is_ascii_alphanumeric())
                    {
                        format!(" {text}")
                    } else {
                        text
                    };
                    h.assistant.draft.push(crate::wordmate::DraftWord {
                        candidate,
                        keys,
                        text: output,
                    });
                }
            });
            self.refresh(client);
            return true;
        }
        let (owned, cursor) = host::with(|h| {
            h.engine
                .query()
                .ok()
                .map(|query| (query.marked_text(), query.marked_cursor()))
        })
        .flatten()
        .unwrap_or_default();
        let source_meaning = candidate.text.clone();
        host::with(|h| {
            h.engine.commit_translation(&candidate, sense);
        });
        let confirmed = client.insert_composition_verified(&text, &owned, cursor);
        host::with(|h| {
            h.assistant.note_text(&text);
            if confirmed {
                h.assistant.learn(&text, &source_meaning, "annotation");
            }
            h.assistant.invalidate(false);
        });
        self.refresh(client);
        true
    }

    /// 修饰键 + 数字（缺省 ⇧）：删掉当前页第几个候选。不在组句中不管；那格没有候选就吞掉按键不动。
    /// 删完重新查一遍（排序会变），结果那句话显示在拼音行右侧，敲下一键就没了。
    pub(super) fn handle_delete_key(&self, digit: usize, client: TextClient<'_>) -> bool {
        let composing = host::with(|h| h.is_composing()).unwrap_or(false);
        if !composing {
            return false;
        }
        let Some(message) = host::with(|h| h.forget_candidate(digit - 1)).flatten() else {
            tracing::debug!(digit, "这一格没有候选，没什么可删");
            return true;
        };

        self.refresh(client);
        host::with(|h| h.status = Some(message));
        self.render(client);
        true
    }
}
