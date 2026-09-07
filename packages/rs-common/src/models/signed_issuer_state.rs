use prost::Message;

use crate::error::{CoreError, CoreResult};
use crate::models::protos_v2::{
    IssuerPairingState, PairingSessionDigest, PublicKey, SignedIssuerState,
};

impl SignedIssuerState {
    /// Decode the payload and verify the signature against the key specified in the digest.
    /// Returns `(pinned key, digest, issuer state)`.
    /// The digest hash, signer authorization, and expiration should all be
    /// checked separately.
    pub fn open(&self) -> CoreResult<(PublicKey, PairingSessionDigest, IssuerPairingState)> {
        let state = IssuerPairingState::decode(self.state_bytes.as_slice()).map_err(|e| {
            CoreError::DeserializationError(format!(
                "Unable to deserialize IssuerPairingState: {e}"
            ))
        })?;

        let digest =
            PairingSessionDigest::decode(state.session_digest.as_slice()).map_err(|e| {
                CoreError::DeserializationError(format!(
                    "Unable to deserialize PairingSessionDigest: {e}"
                ))
            })?;

        let signer = digest.issuer_signer.clone().ok_or_else(|| {
            CoreError::DeserializationError(
                "Pairing session digest has no issuer_signer".to_owned(),
            )
        })?;

        if !signer.sig_matches(&self.signature, &self.state_bytes) {
            return Err(CoreError::SignatureError(
                "issuer pairing state signature is invalid".to_owned(),
            ));
        }

        Ok((signer, digest, state))
    }
}
