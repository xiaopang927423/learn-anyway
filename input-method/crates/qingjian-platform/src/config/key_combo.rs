use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

use super::modifiers::Modifiers;

/// 修饰键 + 一个字母键的组合，配置里写成 `control+option+t`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct KeyCombo {
    /// 修饰键，至少一个。
    pub modifiers: Modifiers,

    /// 字母或数字键（小写）。
    pub key: char,
}

impl KeyCombo {
    pub const TRANSLATE_DEFAULT: Self = Self {
        modifiers: Modifiers {
            option: true,
            shift: false,
            control: true,
            command: false,
        },
        key: 't',
    };

    /// 配置文件里的写法。
    pub fn key_string(&self) -> String {
        let key = match self.key {
            ' ' => "space".into(),
            '\t' => "tab".into(),
            c => c.to_string(),
        };
        if self.modifiers.is_empty() {
            key
        } else {
            format!("{}+{key}", self.modifiers.key())
        }
    }

    /// 给人看的写法：`⌃⌥T`。
    pub fn label(&self) -> String {
        let key = match self.key {
            ' ' => "Space".into(),
            '\t' => "Tab".into(),
            c => c.to_ascii_uppercase().to_string(),
        };
        format!("{}{key}", self.modifiers.label())
    }
}

impl Default for KeyCombo {
    fn default() -> Self {
        Self::TRANSLATE_DEFAULT
    }
}

impl FromStr for KeyCombo {
    type Err = String;

    fn from_str(text: &str) -> Result<Self, Self::Err> {
        let text = text.trim();
        let (mods, name) = text.rsplit_once('+').unwrap_or(("", text));
        let special = match name.trim().to_ascii_lowercase().as_str() {
            "space" => Some(' '),
            "tab" => Some('\t'),
            _ => None,
        };
        let key = if let Some(key) = special {
            key
        } else {
            let mut chars = name.trim().chars();
            match (chars.next(), chars.next()) {
                (Some(c), None) if c.is_ascii_alphanumeric() && !mods.is_empty() => {
                    c.to_ascii_lowercase()
                }
                _ => return Err("请使用 Space、Tab 或带修饰键的字母/数字；不能使用回车".into()),
            }
        };
        let modifiers = if mods.is_empty() {
            Modifiers::default()
        } else {
            mods.parse()?
        };
        Ok(Self {
            modifiers,
            key: key.to_ascii_lowercase(),
        })
    }
}

impl TryFrom<String> for KeyCombo {
    type Error = String;

    fn try_from(text: String) -> Result<Self, Self::Error> {
        text.parse()
    }
}

impl From<KeyCombo> for String {
    fn from(combo: KeyCombo) -> Self {
        combo.key_string()
    }
}

impl fmt::Display for KeyCombo {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.key_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_labels() {
        let combo: KeyCombo = "control+option+t".parse().unwrap();
        assert_eq!(combo, KeyCombo::TRANSLATE_DEFAULT);
        assert_eq!(combo.label(), "⌃⌥T");
        assert_eq!(combo.key_string(), "control+option+t");
        assert!("t".parse::<KeyCombo>().is_err());
        assert!("option+tt".parse::<KeyCombo>().is_err());
        assert!("option+-".parse::<KeyCombo>().is_err());
        for option in ["control+shift+t", "control+option+e", "shift+command+9"] {
            assert_eq!(option.parse::<KeyCombo>().unwrap().key_string(), option);
        }
    }
}
