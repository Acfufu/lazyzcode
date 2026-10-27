// Own-child identity probe; does not enumerate or signal unrelated processes.
#include <mach/mach.h>
#include <libproc.h>
#include <sys/wait.h>
#include <unistd.h>
#include <signal.h>
#include <stdio.h>
#include <errno.h>
int main(void) {
  int fd[2]; if (pipe(fd) == -1) return 1;
  pid_t child = fork(); if (child == -1) return 2;
  if (!child) {
    close(fd[0]); audit_token_t token;
    mach_msg_type_number_t count = TASK_AUDIT_TOKEN_COUNT;
    if (task_info(mach_task_self(), TASK_AUDIT_TOKEN, (task_info_t)&token, &count) != KERN_SUCCESS) _exit(3);
    write(fd[1], &token, sizeof(token)); close(fd[1]); sleep(5); _exit(0);
  }
  close(fd[1]); audit_token_t token;
  if (read(fd[0], &token, sizeof(token)) != sizeof(token)) { waitpid(child,0,0); return 4; }
  close(fd[0]); audit_token_t stale = token; stale.val[7]++;
  errno = 0; int staleResult = proc_signal_with_audittoken(&stale, SIGKILL), staleErrno = errno;
  int stillAlive = kill(child,0) == 0;
  errno = 0; int result = proc_signal_with_audittoken(&token,SIGKILL), savedErrno = errno;
  int status; waitpid(child,&status,0);
  printf("{\"uid\":%d,\"staleResult\":%d,\"staleErrno\":%d,\"aliveAfterStale\":%s,\"validResult\":%d,\"validErrno\":%d,\"killed\":%s}\n",getuid(),staleResult,staleErrno,stillAlive?"true":"false",result,savedErrno,WIFSIGNALED(status)&&WTERMSIG(status)==SIGKILL?"true":"false");
  return 0;
}
