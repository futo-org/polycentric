use std::collections::HashMap;

/// Tracks the highest issuer state sequence seen for each pairing session.
/// This lets us handle sequence checking and prevent state rollbacks in a way
/// that's transparent to js-core.
#[derive(Debug, Default)]
pub struct PairingStore {
    /// Maps a SHA256 hash of a pairing session digest to the highest sequence
    /// that we have seen for that pairing session.
    sequences: HashMap<Vec<u8>, i64>,
}

impl PairingStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Check a candidate sequence against what we have observed so far,
    /// and update the recorded state accordingly.
    /// Returns `false` iff the new sequence would roll back state.
    pub fn try_sequence(&mut self, digest_sha256: &[u8], sequence: i64) -> bool {
        let floor = self.sequences.get(digest_sha256).copied().unwrap_or(1);

        // Ensure that we are not reverting state to an outdated verison
        if sequence < floor {
            return false;
        }

        self.sequences.insert(digest_sha256.to_vec(), sequence);
        true
    }

    /// Ensure that the sequence floor for the session matching `digest_sha256`
    /// is at least `sequence`.
    pub fn accept_sequence(&mut self, digest_sha256: &[u8], sequence: i64) {
        let stored = self.sequences.get(digest_sha256).copied().unwrap_or(1);

        if sequence > stored {
            self.sequences.insert(digest_sha256.to_vec(), sequence);
        }
    }
}
