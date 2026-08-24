import vm from "node:vm";
/**
 * Execute a user transform script in a hardened VM context.
 *
 * The script receives `{ request, body }` and returns the replacement body
 * (object → JSON-serialized by the server, or a raw string). No require,
 * no process, no network. 250 ms hard timeout.
 *
 * Throws on timeout or uncaught script error — callers turn that into a 500
 * with an X-Mock-Script-Error header.
 */
export function runTransform(code, input) {
    const sandbox = {
        request: input.request,
        body: input.body,
        state: input.state,
        JSON,
        Math,
        Date,
        console: {
            log: () => { },
            warn: () => { },
            error: () => { },
        },
    };
    const context = vm.createContext(sandbox, {
        codeGeneration: { strings: false, wasm: false },
    });
    const script = new vm.Script(`(function(){\n${code}\n})()`);
    const result = script.runInContext(context, { timeout: 250, displayErrors: true });
    return result;
}
//# sourceMappingURL=scripts.js.map