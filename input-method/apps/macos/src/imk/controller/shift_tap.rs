//! A solo Shift tap switches languages; chords, dual Shift, hold and focus changes cancel it.
#[derive(Default)]
pub(super) struct ShiftTap {
    pending: Option<(u16, f64)>,
}
impl ShiftTap {
    pub fn cancel(&mut self) {
        self.pending = None;
    }
    pub fn flags(&mut self, key: u16, shift: bool, other: bool, timestamp: f64) -> bool {
        if !matches!(key, 56 | 60) || other {
            self.cancel();
            return false;
        }
        if shift {
            if self.pending.is_some() {
                self.cancel();
            } else {
                self.pending = Some((key, timestamp));
            }
            false
        } else {
            self.pending.take().is_some_and(|(pressed, started)| {
                pressed == key && (0.0..=0.6).contains(&(timestamp - started))
            })
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn solo_shift_only() {
        let mut tap = ShiftTap::default();
        assert!(!tap.flags(56, true, false, 1.));
        assert!(tap.flags(56, false, false, 1.1));
        assert!(!tap.flags(56, false, false, 1.2));
        tap.flags(60, true, false, 2.);
        tap.cancel();
        assert!(!tap.flags(60, false, false, 2.1));
        tap.flags(56, true, false, 3.);
        assert!(!tap.flags(56, false, false, 4.));
        tap.flags(56, true, false, 5.);
        tap.flags(59, true, true, 5.1);
        assert!(!tap.flags(56, false, false, 5.2));
        tap.flags(56, true, false, 6.);
        tap.flags(60, true, false, 6.1);
        assert!(!tap.flags(56, false, false, 6.2));
    }
}
