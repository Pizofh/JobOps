const commonRules = {
  curly: ['error', 'all'],
  eqeqeq: ['error', 'always'],
  'no-undef': 'error',
  'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  'no-var': 'error',
  'prefer-const': 'error',
};

module.exports = [
  {
    ignores: ['node_modules/**', 'coverage/**'],
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: commonRules,
  },
  {
    files: ['tests/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        __dirname: 'readonly',
        console: 'readonly',
        module: 'readonly',
        process: 'readonly',
        require: 'readonly',
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: commonRules,
  },
];
