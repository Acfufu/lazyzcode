// Offline R0 prototype. Compile ahead of time; no PowerShell/CLR at runtime.
// Protocol is deliberately fixture-only, not a production command dispatcher.
#define _WIN32_WINNT 0x0A00
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <wchar.h>
#include <stdlib.h>
#include <string.h>
#ifndef PROC_THREAD_ATTRIBUTE_JOB_LIST
#define PROC_THREAD_ATTRIBUTE_JOB_LIST ProcThreadAttributeValue(13, FALSE, TRUE, FALSE)
#endif
static HANDLE job, finished;
static void fail(const char *where) {
  DWORD e = GetLastError();
  fprintf(stderr, "{\"error\":\"%s\",\"win32\":%lu}\n", where, (unsigned long)e);
  if (job) TerminateJobObject(job, 71);
  ExitProcess(71);
}
static DWORD WINAPI watchdog(LPVOID unused) {
  (void)unused;
  if (WaitForSingleObject(finished, 30000) != WAIT_OBJECT_0) {
    TerminateJobObject(job, 124); ExitProcess(124);
  }
  return 0;
}
static DWORD active(void) {
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION a;
  if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation, &a, sizeof(a), NULL)) fail("query");
  return a.ActiveProcesses;
}
static void stop(void) {
  if (!TerminateJobObject(job, 99)) fail("terminate");
  ULONGLONG end = GetTickCount64() + 5000;
  while (active()) { if (GetTickCount64() >= end) { SetLastError(ERROR_TIMEOUT); fail("empty-timeout"); } Sleep(10); }
  puts("{\"event\":\"empty\",\"active\":0}"); fflush(stdout);
}
// Quote a single argv value according to the Windows C runtime parsing rules.
static void quote(wchar_t **dst, const wchar_t *s) {
  *(*dst)++ = L'"';
  while (*s) {
    size_t slashes = 0;
    while (*s == L'\\') { slashes++; s++; }
    size_t count = (*s == L'"' || !*s) ? slashes * 2 : slashes;
    while (count--) *(*dst)++ = L'\\';
    if (*s == L'"') *(*dst)++ = L'\\';
    if (*s) *(*dst)++ = *s++;
  }
  *(*dst)++ = L'"'; *(*dst)++ = L' '; **dst = 0;
}
static void launch(wchar_t **argv, const wchar_t *role, BOOL suspended) {
  SIZE_T bytes = 0;
  InitializeProcThreadAttributeList(NULL, 1, 0, &bytes);
  LPPROC_THREAD_ATTRIBUTE_LIST attrs = HeapAlloc(GetProcessHeap(), 0, bytes);
  if (!attrs) { SetLastError(ERROR_NOT_ENOUGH_MEMORY); fail("allocate"); }
  if (!InitializeProcThreadAttributeList(attrs, 1, 0, &bytes)) fail("attribute-init");
  if (!UpdateProcThreadAttribute(attrs, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST, &job, sizeof(job), NULL, NULL)) fail("attribute-job");
  size_t cap = 2 * (wcslen(argv[1]) + wcslen(argv[2]) + wcslen(argv[3]) + wcslen(role)) + 32;
  wchar_t *cmd = calloc(cap, sizeof(wchar_t)), *next = cmd;
  if (!cmd) { SetLastError(ERROR_NOT_ENOUGH_MEMORY); fail("command-allocate"); }
  quote(&next, argv[1]); quote(&next, argv[2]); quote(&next, role); quote(&next, argv[3]);
  STARTUPINFOEXW si; PROCESS_INFORMATION pi;
  ZeroMemory(&si, sizeof(si)); ZeroMemory(&pi, sizeof(pi));
  si.StartupInfo.cb = sizeof(si); si.lpAttributeList = attrs;
  BOOL ok = CreateProcessW(argv[1], cmd, NULL, NULL, FALSE,
    EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | CREATE_NO_WINDOW,
    NULL, argv[3], &si.StartupInfo, &pi);
  DWORD err = GetLastError();
  DeleteProcThreadAttributeList(attrs); HeapFree(GetProcessHeap(), 0, attrs); free(cmd);
  if (!ok) { SetLastError(err); fail("create"); }
  BOOL member = FALSE;
  if (!IsProcessInJob(pi.hProcess, job, &member) || !member) fail("membership");
  printf("{\"event\":\"created\",\"pid\":%lu,\"memberBeforeResume\":true,\"suspended\":%s}\n", (unsigned long)pi.dwProcessId, suspended ? "true" : "false"); fflush(stdout);
  if (!suspended) {
    if (ResumeThread(pi.hThread) == (DWORD)-1) fail("resume");
    if (WaitForSingleObject(pi.hProcess, 10000) != WAIT_OBJECT_0) { SetLastError(ERROR_TIMEOUT); fail("segment-timeout"); }
    DWORD code;
    if (!GetExitCodeProcess(pi.hProcess, &code) || code != 0) { SetLastError(ERROR_PROCESS_ABORTED); fail("segment-exit"); }
  }
  CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
  printf("{\"event\":\"segment\",\"active\":%lu}\n", (unsigned long)active()); fflush(stdout);
}
int wmain(int argc, wchar_t **argv) {
  if (argc >= 3 && argc <= 5 && !wcscmp(argv[1], L"--observe")) {
    HANDLE handles[3]; int n = argc - 2;
    for (int i = 0; i < n; i++) {
      wchar_t *end; unsigned long pid = wcstoul(argv[i + 2], &end, 10);
      if (*end || !pid) return 64;
      handles[i] = OpenProcess(SYNCHRONIZE, FALSE, (DWORD)pid);
      if (!handles[i]) fail("observe-open");
    }
    puts("{\"event\":\"observer-ready\"}"); fflush(stdout);
    if (WaitForMultipleObjects(n, handles, TRUE, 10000) != WAIT_OBJECT_0) { SetLastError(ERROR_TIMEOUT); fail("observe-wait"); }
    for (int i = 0; i < n; i++) CloseHandle(handles[i]);
    printf("{\"event\":\"observer-exited\",\"handleCount\":%d}\n", n); return 0;
  }
  if (argc != 5 || wcslen(argv[4]) != 36) return 64;
  for (const wchar_t *p = argv[4]; *p; p++) if (!((*p >= L'0' && *p <= L'9') || (*p >= L'a' && *p <= L'f') || *p == L'-')) return 64;
  wchar_t name[80]; swprintf(name, 80, L"Local\\lzy-r0-%ls", argv[4]);
  SetLastError(0); job = CreateJobObjectW(NULL, name);
  if (!job) fail("job-create");
  if (GetLastError() == ERROR_ALREADY_EXISTS) {
    // An existing name gives no authority over the other owner's job.
    CloseHandle(job); job = NULL; SetLastError(ERROR_ALREADY_EXISTS); fail("job-identity-collision");
  }
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits; ZeroMemory(&limits, sizeof(limits));
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) fail("limits");
  finished = CreateEventW(NULL, TRUE, FALSE, NULL);
  if (!finished) fail("watchdog-event");
  HANDLE watch = CreateThread(NULL, 0, watchdog, NULL, 0, NULL);
  if (!watch) fail("watchdog-thread");
  puts("{\"schemaVersion\":1,\"event\":\"ready\",\"backend\":\"win32-job\"}"); fflush(stdout);
  char line[32];
  while (fgets(line, sizeof(line), stdin)) {
    if (!strcmp(line, "segment1\n")) launch(argv, L"segment1", FALSE);
    else if (!strcmp(line, "segment2\n")) launch(argv, L"segment2", FALSE);
    else if (!strcmp(line, "suspended\n")) launch(argv, L"service", TRUE);
    else if (!strcmp(line, "stop\n")) break;
    else { SetLastError(ERROR_INVALID_DATA); fail("protocol"); }
  }
  // EOF is cancellation, including parent death. No job handle is inherited.
  stop(); SetEvent(finished); WaitForSingleObject(watch, INFINITE);
  CloseHandle(watch); CloseHandle(finished); CloseHandle(job);
  return 0;
}
