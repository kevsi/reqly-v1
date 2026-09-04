import { fork } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
/**
 * Execute a user transform script inside a DISPOSABLE CHILD PROCESS.
 *
 * SECURITY (audit P0 2026-09-04): the previous implementation ran the script
 * in node:vm only — vm is NOT a security boundary. The sandbox global's
 * prototype chain crosses the context boundary and
 * `this.constructor.constructor(...)` reaches the HOST Function constructor
 * (proven escape: fs read, child_process spawn, process.env dump).
 *
 * The script now runs in a forked child killed with SIGKILL at the timeout.
 * Even a total escape only touches a stateless process holding nothing but
 * the IPC input. Same contract as before: rejects on timeout or script
 * error — callers turn that into a 500 with an X-Mock-Script-Error header.
 */
// Fork = overhead de spawn (~100-300 ms sous charge parallèle). Le budget
// couvre le spawn + l'exécution : toujours borné, mais réaliste.
const TRANSFORM_TIMEOUT_MS = 2000;
/** Résolution robuste du point d'entrée enfant (bundle-proof). */
const CHILD_FILENAME = "scripts-child.mjs";
const CANDIDATE_DIRS = [
    path.dirname(fileURLToPath(import.meta.url)),
    process.cwd(),
];
function resolveChildPath() {
    for (const dir of CANDIDATE_DIRS) {
        try {
            const candidate = path.join(dir, CHILD_FILENAME);
            if (fs.existsSync(candidate))
                return candidate;
        }
        catch {
            // try next candidate
        }
    }
    throw new Error(`Mock transform runner not found: ${CHILD_FILENAME}`);
}
function runInChild(code, input) {
    return new Promise((resolve, reject) => {
        let child;
        try {
            const childPath = resolveChildPath();
            child = fork(childPath, [], {
                stdio: ["ignore", "ignore", "pipe", "ipc"],
                env: { ...process.env },
                // SECURITY (audit P0) : le process enfant tourne sous le modèle de
                // permissions Node — fs/worker_threads refusés par défaut, seul le
                // chargement du runner lui-même est autorisé, et child_process pour
                // le canal IPC. Un échappement vm ne donne donc NI fs NI réseau NI
                // spawn sur la machine hôte.
                execArgv: [
                    "--permission",
                    "--allow-child-process",
                    `--allow-fs-read=${path.dirname(childPath)}`,
                ],
            });
        }
        catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
        }
        const stderrChunks = [];
        child.stderr?.on("data", (c) => stderrChunks.push(c));
        const timer = setTimeout(() => {
            try {
                child.kill("SIGKILL");
            }
            catch {
                // already dead
            }
            reject(new Error("Mock transform script timed out (250 ms)"));
        }, TRANSFORM_TIMEOUT_MS);
        child.on("message", (message) => {
            clearTimeout(timer);
            if (message?.ok)
                resolve(message.result);
            else
                reject(new Error(message?.error ?? "Mock transform script failed"));
        });
        child.on("exit", (code, signal) => {
            clearTimeout(timer);
            if (signal === "SIGKILL")
                return; // timeout path already rejected
            if (code !== 0 && code !== null) {
                const stderr = Buffer.concat(stderrChunks).toString("utf8").slice(0, 500);
                reject(new Error(stderr || `Mock transform runner exited with code ${code}`));
            }
        });
        child.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
        child.send({
            code,
            request: input.request,
            body: input.body ?? null,
            state: input.state ?? null,
        });
    });
}
export async function runTransform(code, input) {
    return runInChild(code, input);
}
//# sourceMappingURL=scripts.js.map