import Module from "node:module";
import * as sidebar from "../interface/sidebarApi";
import * as colors from "../util/mcColors";

// let external plugins import the same instance of the apis available to the proxy itself, so they can use the same types and functions
// for ie. sidebar construction or bossbar modification, without having to import from a path, since that isnt possible while compiled to an executable.
// this is a bit hacky but it works, and is the only way to get a plugin to use the same instance of the apis as the proxy itself, so they can share state and types
const api = {
    ...sidebar,
    colors,
};

export type RProxPluginHost = typeof api;

// every name a plugin may ask for, pointing at the one instance we already have
// needs to be updated when implementing new interfaces, so they can be imported by plugins without having to import from a path
// furthermore, update plugins/rprox.d.ts to declare the new module for type checking and linting, so plugins can import it without having to import from a path
const registry = new Map<string, unknown>([
    ["rprox", api],
    ["rprox/sidebar", sidebar],
    ["rprox/colors", colors],
    // what a plugin written against the checked out repo would have asked for
    ["interface/sidebarApi", sidebar],
    ["util/mcColors", colors],
]);

// ../src/interface/sidebarApi, ./dist/interface/sidebarApi.js and
// interface/sidebarApi are all the same module as far as we care
function normalise(request: string): string {
    const path = request.replace(/\\/g, "/").replace(/\.(?:[cm]?[jt]s)$/, "");
    const inTree = /(?:^|\/)(?:src|dist)\/((?:interface|util)\/[^/]+)$/.exec(path);
    return inTree ? inTree[1] : path;
}

export function resolveHostModule(request: string): unknown | undefined {
    return registry.get(request) ?? registry.get(normalise(request));
}

type Loader = { _load(request: string, parent: unknown, isMain: boolean): unknown };

let installed = false;

// has to be in place before the first external plugin is required
export function installHostModules(): void {
    if (installed) return;
    installed = true;

    const loader = Module as unknown as Loader;
    const original = loader._load;
    loader._load = function (request, parent, isMain) {
        const hit = resolveHostModule(request);
        if (hit) return hit;
        return original.call(this, request, parent, isMain);
    };

    (globalThis as Record<string, unknown>).rProx = api;
}