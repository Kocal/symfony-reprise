import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: ['src/*.ts'],
    // src/stimulus.ts imports `virtual:symfony/controllers`, resolved by the unplugin
    // at build/dev time in a consuming project — never bundle it away here.
    external: [/^virtual:/],
});
