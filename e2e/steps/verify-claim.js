// Acts as the seeded user VERIFIER_NAME: verifies the newest claim asking
// them to, through run.mjs's helper (see verify.mjs). Returns once the verify
// is on the server, so the flow can refresh right after.
const response = http.post(`${MAESTRO_VERIFY_URL}/verify`, {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: VERIFIER_NAME }),
});
if (!response.ok) {
  throw new Error(`Verifying as ${VERIFIER_NAME}: ${response.body}`);
}
