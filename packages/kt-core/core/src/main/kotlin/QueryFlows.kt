package org.futo.polycentric.core

import java.util.logging.Logger
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.buffer
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.firstOrNull
import org.futo.polycentric.ffi.PolycentricCore
import org.futo.polycentric.ffi.Query
import org.futo.polycentric.ffi.QueryObserver
import org.futo.polycentric.ffi.QueryOpts
import org.futo.polycentric.ffi.QueryResultFfi
import org.futo.polycentric.ffi.QueryStatus

class CoreQueryException(message: String) : Exception(message)

private val log = Logger.getLogger("PolycentricCore.query")

/**
 * Bridge the core's `QueryObservable` (fan-out over every configured
 * server) into a cold Kotlin [Flow].
 *
 * Each emission carries the merged result so far plus the fan-out
 * `status`, which is authoritative:
 *  - `Loading` while any server is still outstanding;
 *  - `Success` once at least one server has returned data;
 *  - `Error` once every server has reported and none returned data.
 *
 * The observable also invokes `error(msg)` once per *individual* server
 * that fails, and `complete()` after the last server reports (see rs-core
 * `QueryState::fetch`). A per-server `error` is NOT terminal — other
 * servers may still succeed — so it is logged and dropped rather than
 * closing the flow; closing here would abort the whole query on the first
 * server that happens to fail. Collectors observe outcomes solely through
 * the `status` field.
 */
fun PolycentricCore.queryFlow(
    query: Query,
    queryKey: List<String>? = null,
    opts: QueryOpts? = null,
): Flow<QueryResultFfi> = callbackFlow {
    val observable = fetchQuery(queryKey, query, opts)
    val subscription = observable.subscribe(object : QueryObserver {
        override fun next(result: QueryResultFfi) {
            trySend(result)
        }

        override fun error(message: String) {
            log.warning("Query server error (non-fatal): $message")
        }

        override fun complete() {
            close()
        }
    })
    awaitClose { subscription.unsubscribe() }
    // Unbounded so the non-suspending `trySend` in `next` can never drop an
    // emission (a dropped `Success` would hang `awaitQuery` forever). Fuses
    // with the callbackFlow channel; emission count is bounded by the fan-out.
}.buffer(Channel.UNLIMITED)

/**
 * One-shot query: resolve on the first `Success` emission (at least one
 * server returned data), returning the final merged payload bytes (a
 * serialized response proto — the caller decodes with the matching Wire
 * ADAPTER). A single failing server does not abort the query.
 *
 * Diverges from js-core `PolycentricClient.listEvents`, which rejects on
 * the first per-server error: here an `Error` status (every server
 * reported, none returned data — e.g. the device is offline) throws
 * [CoreQueryException] instead, and per-server errors are ignored while
 * healthy servers are still outstanding (divergences.md).
 */
suspend fun PolycentricCore.awaitQuery(
    query: Query,
    queryKey: List<String>? = null,
    opts: QueryOpts? = null,
): ByteArray? {
    var latest: ByteArray? = null
    queryFlow(query, queryKey, opts).firstOrNull { result ->
        result.data?.let { latest = it }
        when (result.status) {
            QueryStatus.SUCCESS -> true
            QueryStatus.ERROR ->
                throw CoreQueryException("Query failed on all servers")
            QueryStatus.LOADING -> false
        }
    }
    return latest
}
