// types for the "rprox" module the proxy hands to a plugin at runtime. 
// this is not a real module, but rather a virtual module that the proxy hands out to external plugins

// this file is only used for type checking and linting, and is not included in the compiled output, and does not have to be shipped with plugins

// as additional interfaces are added, they should be declared in the modules here as needed
// (ie. when bossbarApi.ts is added, declare it in rprox, and declare its own module for direct imports in plugins)

declare module "rprox" {
    export * from "../src/interface/sidebarApi";
    export * from "../src/interface/windowApi";
    export * as colors from "../src/util/mcColors";
}

declare module "rprox/sidebar" {
    export * from "../src/interface/sidebarApi";
}

declare module "rprox/window" {
    export * from "../src/interface/windowApi";
}

declare module "rprox/colors" {
    export * from "../src/util/mcColors";
}
