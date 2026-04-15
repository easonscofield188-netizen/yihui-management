import js from '@eslint/js';
import vue from 'eslint-plugin-vue';

export default [
  js.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    rules: {
      'vue/multi-word-component-names': 'off',
      'no-unused-vars': 'warn',
    },
    languageOptions: {
      globals: {
        process: 'readonly',
        __dirname: 'readonly',
        localStorage: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        Promise: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        URL: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        navigator: 'readonly',
        window: 'readonly',
        document: 'readonly',
      }
    }
  }
];
