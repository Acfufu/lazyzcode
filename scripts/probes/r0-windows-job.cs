// Probe-only Win32 interop, compiled by PowerShell Add-Type. Not shipped.
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class R0Job {
  public static void Observe(string dir, string ids) {
    var processes = new System.Collections.Generic.List<System.Diagnostics.Process>();
    try {
      foreach (string id in ids.Split(',')) {
        var p = System.Diagnostics.Process.GetProcessById(Int32.Parse(id));
        IntPtr stableHandle = p.Handle; // Hold identity across owner death/PID reuse.
        processes.Add(p);
      }
      Put(Path.Combine(dir,"observer.ready"),"ready");
      foreach (var p in processes) if (!p.WaitForExit(10000)) throw new Exception("owned process still alive");
      Put(Path.Combine(dir,"observer.exited"),"{\"handleCount\":"+processes.Count+",\"allSignaled\":true}");
    } finally { foreach (var p in processes) p.Dispose(); }
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct SI {
    public uint cb; public string reserved, desktop, title;
    public uint x,y,xSize,ySize,xChars,yChars,fill,flags;
    public ushort show, reserved2; public IntPtr reservedPtr, input, output, error;
  }
  [StructLayout(LayoutKind.Sequential)] struct SIX { public SI si; public IntPtr attrs; }
  [StructLayout(LayoutKind.Sequential)] struct PI { public IntPtr process, thread; public uint pid, tid; }
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
    public long processTime, jobTime; public uint flags;
    public UIntPtr minWorking, maxWorking; public uint active;
    public UIntPtr affinity; public uint priority, scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IO { public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct Limits {
    public BasicLimits basic; public IO io;
    public UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr sa, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref Limits info, uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int cls, IntPtr info, uint size, IntPtr length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr bytes);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr key, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcessW(string app, StringBuilder cmd, IntPtr psa, IntPtr tsa, bool inherit, uint flags, IntPtr env, string cwd, ref SIX si, out PI pi);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool member);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint ms);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  static string Q(string s) { return "\"" + s + "\""; }
  static void Put(string path, string text) {
    using(var f = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.Read)) {
      var b = Encoding.UTF8.GetBytes(text); f.Write(b,0,b.Length); f.Flush(true);
    }
  }
  static PI Launch(IntPtr job, string node, string fixture, string role, string dir) {
    IntPtr bytes = IntPtr.Zero;
    InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref bytes);
    IntPtr list = Marshal.AllocHGlobal(bytes), jobs = Marshal.AllocHGlobal(IntPtr.Size);
    try {
      Check(InitializeProcThreadAttributeList(list,1,0,ref bytes));
      Marshal.WriteIntPtr(jobs,job);
      // PROC_THREAD_ATTRIBUTE_JOB_LIST: assignment happens inside creation,
      // before the initial thread can run (no assign-after-spawn crash gap).
      Check(UpdateProcThreadAttribute(list,0,new IntPtr(0x2000d),jobs,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero));
      var si = new SIX(); si.si.cb = (uint)Marshal.SizeOf(typeof(SIX)); si.attrs = list;
      PI pi;
      Check(CreateProcessW(node,new StringBuilder(Q(node)+" "+Q(fixture)+" "+role+" "+Q(dir)),IntPtr.Zero,IntPtr.Zero,false,0x08080004,IntPtr.Zero,dir,ref si,out pi));
      bool member; Check(IsProcessInJob(pi.process,job,out member));
      if (!member) throw new Exception("created child not in job");
      Put(Path.Combine(dir,role+".created"),"{\"pid\":"+pi.pid+",\"memberBeforeResume\":true}");
      return pi;
    } finally { DeleteProcThreadAttributeList(list); Marshal.FreeHGlobal(list); Marshal.FreeHGlobal(jobs); }
  }
  static int Active(IntPtr job) {
    IntPtr data = Marshal.AllocHGlobal(48);
    try { Check(QueryInformationJobObject(job,1,data,48,IntPtr.Zero)); return Marshal.ReadInt32(data,40); }
    finally { Marshal.FreeHGlobal(data); }
  }
  static void Segment(IntPtr job, string node, string fixture, string role, string dir) {
    PI pi = Launch(job,node,fixture,role,dir);
    try { if (ResumeThread(pi.thread) == 0xffffffff) throw new Win32Exception(); if (WaitForSingleObject(pi.process,10000) != 0) throw new Exception("segment timeout"); }
    finally { CloseHandle(pi.thread); CloseHandle(pi.process); }
  }
  public static void Run(string root, string dir, string mode, string node) {
    string name = "Local\\lzy-r0-"+Guid.NewGuid().ToString("N");
    Put(Path.Combine(dir,"intent.json"),"{\"job\":\""+name.Replace("\\","\\\\")+"\",\"mode\":\""+mode+"\"}");
    IntPtr job = CreateJobObjectW(IntPtr.Zero,name);
    if (job == IntPtr.Zero) throw new Win32Exception();
    try {
      var limits = new Limits(); limits.basic.flags = 0x2000; // KILL_ON_JOB_CLOSE; no BREAKAWAY flags
      Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(Limits))));
      string fixture = Path.Combine(root,"scripts/probes/r0-fixture.cjs");
      if (mode == "before-resume") {
        PI pi = Launch(job,node,fixture,"service",dir);
        CloseHandle(pi.thread); CloseHandle(pi.process);
        Put(Path.Combine(dir,"ready.json"),"{\"active\":"+Active(job)+",\"suspended\":true}");
        Thread.Sleep(30000); return;
      }
      Segment(job,node,fixture,"segment1",dir);
      Segment(job,node,fixture,"segment2",dir);
      int active = Active(job);
      Put(Path.Combine(dir,"ready.json"),"{\"active\":"+active+",\"suspended\":false}");
      if (mode == "controller-kill") { Thread.Sleep(30000); return; }
      Check(TerminateJobObject(job,99));
      int waited = 0;
      while (Active(job) != 0 && waited < 10000) { Thread.Sleep(20); waited += 20; }
      if (Active(job) != 0) throw new Exception("job still populated");
      Put(Path.Combine(dir,"empty.json"),"{\"active\":0}");
    } finally { CloseHandle(job); }
  }
}
