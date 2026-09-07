package org.futo.polycentric.core

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import org.futo.polycentric.core.StoredKeyPair
import polycentric.v2.Content
import polycentric.v2.SignedEvent

/** Port of js-core `ClientState`. */
enum class ClientState { UNINITIALIZED, INITIALIZING, READY, ERROR }

/** Port of js-core `InitializationStep` (display strings preserved). */
enum class InitializationStep(val label: String) {
    STARTING("Starting initialization..."),
    INITIALIZING_CORE("Initializing core..."),
    SETTING_UP_STORAGE("Setting up storage..."),
    LOADING_PROCESS_ID("Loading process ID..."),
    CREATING_PROCESS_ID("Creating process ID..."),
    HYDRATING_EVENTS("Hydrating events..."),
    CREATING_EPHEMERAL_IDENTITY("Creating ephemeral identity..."),
    COMPLETE("Initialization complete."),
}

/** Port of js-core `HydrationStatus`. */
enum class HydrationStatus { NOT_STARTED, IN_PROGRESS, FAILED, COMPLETED }

class ContentCreatedPayload(
    val signedEvent: SignedEvent,
    /** Present when the commit included content. */
    val content: Content?,
)

/**
 * Port of js-core `client-internal/event-service.ts` — the client's
 * outward event bus, as Kotlin flows instead of eventemitter3.
 *
 * Stateful signals (client state, hydration, progress) are [StateFlow]s
 * so late subscribers see the current value; one-shot signals (content
 * created, key pair changed, errors) are [SharedFlow]s whose emitters
 * suspend when a slow collector's buffer is full — like eventemitter3's
 * synchronous delivery, an emission is never silently dropped (with no
 * collectors it is discarded, also like an emitter with no listeners).
 */
class EventService {
    private val _state = MutableStateFlow(ClientState.UNINITIALIZED)
    val state: StateFlow<ClientState> = _state

    private val _progress = MutableStateFlow(InitializationStep.STARTING)
    val progress: StateFlow<InitializationStep> = _progress

    private val _hydrationStatus = MutableStateFlow(HydrationStatus.NOT_STARTED)
    val hydrationStatus: StateFlow<HydrationStatus> = _hydrationStatus

    private val _keyPairChanged = MutableSharedFlow<StoredKeyPair?>(extraBufferCapacity = 16)
    val keyPairChanged: SharedFlow<StoredKeyPair?> = _keyPairChanged

    private val _contentCreated = MutableSharedFlow<ContentCreatedPayload>(extraBufferCapacity = 64)
    val contentCreated: SharedFlow<ContentCreatedPayload> = _contentCreated

    private val _errors = MutableSharedFlow<Throwable>(extraBufferCapacity = 16)
    val errors: SharedFlow<Throwable> = _errors

    internal fun emitStateChanged(state: ClientState) {
        _state.value = state
    }

    internal fun emitProgress(step: InitializationStep) {
        _progress.value = step
    }

    internal fun emitHydrationStatus(status: HydrationStatus) {
        _hydrationStatus.value = status
    }

    internal suspend fun emitKeyPairChanged(keyPair: StoredKeyPair?) {
        _keyPairChanged.emit(keyPair)
    }

    internal suspend fun emitContentCreated(payload: ContentCreatedPayload) {
        _contentCreated.emit(payload)
    }

    internal suspend fun emitError(error: Throwable) {
        _errors.emit(error)
    }
}
