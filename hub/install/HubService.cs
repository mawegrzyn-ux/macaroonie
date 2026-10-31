// hub/install/HubService.cs
//
// The Macaroonie venue hub as a Windows service. install.ps1 carries this
// file (the API puts it in when it serves the installer), writes it to
// C:\ProgramData\Macaroonie\Hub\hub-service.cs and compiles it there with the
// C# compiler that comes with Windows (.NET Framework 4, csc.exe, C# 5 only),
// so nothing is downloaded and there is nothing to sign. Then it registers
// hub-service.exe as the service MacaroonieHub ("Macaroonie hub" in Services):
// starts with the computer as LocalSystem, no one needs to sign in, and
// Windows starts it again if it fails.
//
// It runs, from the folder it is in (the hub's home):
//
//   node\node.exe launcher.mjs <one argument per line of service-args.txt>
//
// inside a job object: stopping the service, or this program dying, ends the
// launcher, the hub it runs and anything they started, so no hub is ever left
// holding its ports or its link. When the launcher stops by itself (it
// shouldn't: it keeps the hub running and handles updates) it is started
// again after a wait that grows while it keeps stopping.
//
// What it does goes to service.log beside it; the hub's own log is hub.log.
//
//   hub-service.exe --console [--home DIR]   the same in a terminal (tests;
//                                            Ctrl+C or Enter stops it)
//   hub-service.exe --version
//
// C# 5 only (no $"", no ?.): the compiler Windows has is the old one.

using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.ServiceProcess;
using System.Text;
using System.Threading;

namespace Macaroonie
{
    public class HubService : ServiceBase
    {
        public const string Version = "1";
        public const string Name = "MacaroonieHub";
        const long LogMax = 1024 * 1024;
        const int QuickSeconds = 60;

        readonly string home;
        readonly bool console;
        readonly ManualResetEvent stopping = new ManualResetEvent(false);
        readonly object gate = new object();
        Thread worker;
        IntPtr job = IntPtr.Zero;
        Process current;
        bool noJobs;

        public HubService(string home, bool console)
        {
            this.home = home;
            this.console = console;
            ServiceName = Name;
            CanStop = true;
            CanShutdown = true;
            CanPauseAndContinue = false;
            AutoLog = false;
        }

        // ---- the service ------------------------------------------------

        protected override void OnStart(string[] args)
        {
            Begin();
        }

        protected override void OnStop()
        {
            End("the service was stopped");
        }

        protected override void OnShutdown()
        {
            End("Windows is shutting down");
        }

        public void Begin()
        {
            stopping.Reset();
            Log("Macaroonie hub service " + Version + " starting in " + home);
            worker = new Thread(Run);
            worker.IsBackground = true;
            worker.Name = "hub";
            worker.Start();
        }

        public void End(string why)
        {
            Log("Stopping: " + why);
            stopping.Set();
            EndRun();
            if (worker != null && !worker.Join(15000)) Log("The hub's thread didn't stop in time");
            Log("Stopped");
        }

        // ---- running the launcher ---------------------------------------

        void Run()
        {
            int quick = 0;
            while (!stopping.WaitOne(0))
            {
                string node = FindNode();
                string launcher = Path.Combine(home, "launcher.mjs");
                if (node == null || !File.Exists(launcher))
                {
                    Log("Node.js or launcher.mjs isn't in " + home + ": run the installer again. Looking again in 30 s");
                    if (stopping.WaitOne(30000)) break;
                    continue;
                }

                List<string> args = new List<string>();
                args.Add(launcher);
                args.AddRange(ReadArgs());

                DateTime started = DateTime.UtcNow;
                Process p;
                try
                {
                    p = Start(node, args);
                }
                catch (Exception e)
                {
                    Log("Couldn't start the hub: " + e.Message + ". Trying again in 30 s");
                    EndRun();
                    if (stopping.WaitOne(30000)) break;
                    continue;
                }
                Log("Started the hub (process " + p.Id + ")");

                while (!p.WaitForExit(1000))
                {
                    if (stopping.WaitOne(0)) break;
                }
                if (stopping.WaitOne(0)) break;

                int code = -1;
                try { p.WaitForExit(); code = p.ExitCode; } catch { }
                // Anything the launcher left behind (the hub it ran) goes with it.
                EndRun();

                quick = (DateTime.UtcNow - started).TotalSeconds < QuickSeconds ? quick + 1 : 0;
                int wait = quick == 0 ? 5000 : Math.Min(5000 << Math.Min(quick - 1, 4), 60000);
                Log("The hub's launcher stopped (exit " + code + "): starting it again in " + (wait / 1000) + " s");
                if (stopping.WaitOne(wait)) break;
            }
        }

        string FindNode()
        {
            string[] candidates = {
                Path.Combine(home, Path.Combine("node", "node.exe")),
                Path.Combine(home, Path.Combine("node", Path.Combine("bin", "node")))
            };
            foreach (string c in candidates) if (File.Exists(c)) return c;
            return null;
        }

        List<string> ReadArgs()
        {
            List<string> args = new List<string>();
            string file = Path.Combine(home, "service-args.txt");
            if (!File.Exists(file)) return args;
            foreach (string line in File.ReadAllLines(file))
            {
                string a = line.Trim();
                if (a.Length > 0) args.Add(a);
            }
            return args;
        }

        Process Start(string node, List<string> args)
        {
            ProcessStartInfo psi = new ProcessStartInfo(node);
            StringBuilder cmd = new StringBuilder();
            foreach (string a in args)
            {
                if (cmd.Length > 0) cmd.Append(' ');
                cmd.Append(Quote(a));
            }
            psi.Arguments = cmd.ToString();
            psi.WorkingDirectory = home;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardInput = false;
            // The launcher writes hub.log itself; its own output is drained (a
            // full pipe would stop it) and only errors are kept here.
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.EnvironmentVariables["MACAROONIE_HUB_HOME"] = home;
            psi.EnvironmentVariables["MACAROONIE_HUB_SERVICE"] = "1";

            IntPtr j = NewJob();
            Process p = Process.Start(psi);
            if (j != IntPtr.Zero && !AssignProcessToJobObject(j, p.Handle))
            {
                Log("Couldn't put the hub in its job (error " + Marshal.GetLastWin32Error() + "): stopping the service may leave it running");
            }
            p.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { };
            p.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e)
            {
                if (!string.IsNullOrEmpty(e.Data)) Log("node: " + e.Data);
            };
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            lock (gate)
            {
                job = j;
                current = p;
            }
            return p;
        }

        /// Ends the running launcher and everything in its job.
        void EndRun()
        {
            IntPtr j;
            Process p;
            lock (gate)
            {
                j = job;
                p = current;
                job = IntPtr.Zero;
                current = null;
            }
            if (j != IntPtr.Zero)
            {
                try { TerminateJobObject(j, 1); } catch { }
                try { CloseHandle(j); } catch { }
            }
            else if (p != null)
            {
                // No job objects (not Windows: the tests): the launcher itself.
                try { if (!p.HasExited) p.Kill(); } catch { }
            }
            if (p != null)
            {
                try { p.WaitForExit(5000); } catch { }
                try { p.Dispose(); } catch { }
            }
        }

        /// A command-line argument as Windows programs (Node) read it back.
        public static string Quote(string a)
        {
            if (a.Length > 0 && a.IndexOfAny(new char[] { ' ', '\t', '"' }) < 0) return a;
            StringBuilder sb = new StringBuilder("\"");
            int slashes = 0;
            foreach (char c in a)
            {
                if (c == '\\') { slashes++; continue; }
                if (c == '"')
                {
                    sb.Append('\\', slashes * 2 + 1);
                    sb.Append('"');
                }
                else
                {
                    sb.Append('\\', slashes);
                    sb.Append(c);
                }
                slashes = 0;
            }
            sb.Append('\\', slashes * 2);
            sb.Append('"');
            return sb.ToString();
        }

        // ---- the job object ---------------------------------------------

        IntPtr NewJob()
        {
            if (noJobs) return IntPtr.Zero;
            try
            {
                IntPtr j = CreateJobObject(IntPtr.Zero, null);
                if (j == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
                IntPtr ptr = Marshal.AllocHGlobal(size);
                try
                {
                    Marshal.StructureToPtr(info, ptr, false);
                    if (!SetInformationJobObject(j, JobObjectExtendedLimitInformation, ptr, (uint)size))
                    {
                        int err = Marshal.GetLastWin32Error();
                        CloseHandle(j);
                        throw new Win32Exception(err);
                    }
                }
                finally
                {
                    Marshal.FreeHGlobal(ptr);
                }
                return j;
            }
            catch (Exception e)
            {
                if (e is DllNotFoundException || e is EntryPointNotFoundException)
                {
                    noJobs = true;
                    Log("No job objects here (not Windows): stopping ends the launcher only");
                }
                else
                {
                    Log("Couldn't make the hub's job: " + e.Message);
                }
                return IntPtr.Zero;
            }
        }

        const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
        const int JobObjectExtendedLimitInformation = 9;

        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr CreateJobObject(IntPtr attributes, string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool TerminateJobObject(IntPtr job, uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool CloseHandle(IntPtr handle);

        // ---- the log ----------------------------------------------------

        readonly object logGate = new object();

        void Log(string line)
        {
            string text = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ") + "  service: " + line;
            if (console) Console.WriteLine(text);
            lock (logGate)
            {
                try
                {
                    string file = Path.Combine(home, "service.log");
                    FileInfo f = new FileInfo(file);
                    if (f.Exists && f.Length > LogMax)
                    {
                        string old = file + ".1";
                        if (File.Exists(old)) File.Delete(old);
                        File.Move(file, old);
                    }
                    File.AppendAllText(file, text + Environment.NewLine);
                }
                catch { }
            }
        }

        // ---- start ------------------------------------------------------

        public static int Main(string[] args)
        {
            string home = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
            bool console = false;
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--version") { Console.WriteLine(Version); return 0; }
                if (args[i] == "--console") console = true;
                if (args[i] == "--home" && i + 1 < args.Length) home = Path.GetFullPath(args[++i]);
            }
            HubService service = new HubService(home, console);
            if (!console)
            {
                ServiceBase.Run(service);
                return 0;
            }
            // In a terminal: Ctrl+C, Enter or the end of input stops it.
            ManualResetEvent done = new ManualResetEvent(false);
            Console.CancelKeyPress += delegate(object s, ConsoleCancelEventArgs e) { e.Cancel = true; done.Set(); };
            service.Begin();
            Thread input = new Thread(delegate()
            {
                try { Console.In.ReadLine(); } catch { }
                done.Set();
            });
            input.IsBackground = true;
            input.Start();
            done.WaitOne();
            service.End("asked to stop");
            return 0;
        }
    }
}
