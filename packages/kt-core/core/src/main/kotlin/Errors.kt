package org.futo.polycentric.core

/**
 * Typed error hierarchy — port of js-core `errors.ts` (grown as the
 * managers that throw them get ported; only IdentityManager's errors
 * exist so far).
 */
open class PolycentricException(message: String, cause: Throwable? = null) :
    Exception(message, cause)

class NoActiveKeyPairException : PolycentricException("No active key pair")

class NoActiveIdentityException : PolycentricException("No active identity")

class ServerAlreadyAddedException :
    PolycentricException("Server already added")

class IdentityNotFoundException(identityKey: String) :
    PolycentricException("Identity $identityKey not found")

class UnauthorizedKeyException :
    PolycentricException("Current key is not authorized for this identity")

// ── js-core WrapperError family ────────────────────────────────────────
// (WasmError has no analogue here; UniFFI's generated CoreException
// covers Rust-side failures.)

class InvalidKeyLengthException(message: String, cause: Throwable? = null) :
    PolycentricException(message, cause)

class InvalidSignatureException(message: String, cause: Throwable? = null) :
    PolycentricException(message, cause)

/** Thrown by encrypted key-store drivers when encryption fails. */
class EncryptionException(message: String, cause: Throwable? = null) :
    PolycentricException(message, cause)

/** Thrown by encrypted key-store drivers when decryption fails. */
class DecryptionException(message: String, cause: Throwable? = null) :
    PolycentricException(message, cause)

class ConfigurationException(message: String, cause: Throwable? = null) :
    PolycentricException(message, cause)

/** Thrown by storage-driver implementations on database failures. */
class DatabaseException(message: String, cause: Throwable? = null) :
    PolycentricException(message, cause)

class QueryException(message: String, cause: Throwable? = null) :
    PolycentricException(message, cause)

class HttpException(message: String, cause: Throwable? = null) :
    PolycentricException(message, cause)
