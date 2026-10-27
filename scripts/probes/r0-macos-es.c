// Capability probe only: no subscription, no system changes, no entitlement.
#include <EndpointSecurity/EndpointSecurity.h>
#include <unistd.h>
#include <stdio.h>
#include <string.h>
static const char *result_name(es_new_client_result_t r) {
  switch (r) {
    case ES_NEW_CLIENT_RESULT_SUCCESS: return "SUCCESS";
    case ES_NEW_CLIENT_RESULT_ERR_NOT_ENTITLED: return "NOT_ENTITLED";
    case ES_NEW_CLIENT_RESULT_ERR_NOT_PRIVILEGED: return "NOT_PRIVILEGED";
    case ES_NEW_CLIENT_RESULT_ERR_NOT_PERMITTED: return "NOT_PERMITTED";
    case ES_NEW_CLIENT_RESULT_ERR_TOO_MANY_CLIENTS: return "TOO_MANY_CLIENTS";
    case ES_NEW_CLIENT_RESULT_ERR_INVALID_ARGUMENT: return "INVALID_ARGUMENT";
    default: return "INTERNAL_OR_UNKNOWN";
  }
}
int main(int argc, char **argv) {
  // Preflight mode never launches a workload and returns EX_CONFIG when blocked.
  // It intentionally avoids the system-wide API (and its root/TCC requirements).
  if (argc == 2 && strcmp(argv[1], "--descendants-only") == 0) {
    if (__builtin_available(macOS 27.0, *)) {
      es_client_t *probe = NULL;
      es_new_client_result_t r = es_new_descendants_client(&probe, ^(es_client_t *c, const es_message_t *m) { (void)c; (void)m; });
      int deleted = r == ES_NEW_CLIENT_RESULT_SUCCESS ? es_delete_client(probe) : -1;
      int ok = r == ES_NEW_CLIENT_RESULT_SUCCESS && deleted == ES_RETURN_SUCCESS;
      printf("{\"schemaVersion\":1,\"uid\":%d,\"api\":\"descendants\",\"result\":%d,\"resultName\":\"%s\",\"clientDeleted\":%s,\"available\":%s,\"workloadLaunches\":0}\n", getuid(), r, result_name(r), deleted == ES_RETURN_SUCCESS ? "true" : "false", ok ? "true" : "false");
      return ok ? 0 : 78;
    }
    puts("{\"schemaVersion\":1,\"available\":false,\"resultName\":\"OS_UNSUPPORTED\",\"workloadLaunches\":0}");
    return 78;
  }
  if (argc != 1) return 64;
  es_client_t *client = NULL;
  es_new_client_result_t standard = es_new_client(&client, ^(es_client_t *c, const es_message_t *m) { (void)c; (void)m; });
  if (standard == ES_NEW_CLIENT_RESULT_SUCCESS) es_delete_client(client);
  int descendants = -1;
  if (__builtin_available(macOS 27.0, *)) {
    client = NULL;
    descendants = es_new_descendants_client(&client, ^(es_client_t *c, const es_message_t *m) { (void)c; (void)m; });
    if (descendants == ES_NEW_CLIENT_RESULT_SUCCESS) es_delete_client(client);
  }
  printf("{\"uid\":%d,\"standard\":%d,\"descendants\":%d,\"notEntitledCode\":%d}\n", getuid(), standard, descendants, ES_NEW_CLIENT_RESULT_ERR_NOT_ENTITLED);
  return 0;
}
