/**
 * FunctionRegistry unit tests.
 * Run with: pnpm test
 *
 * Mirrors test patterns from codebase-memory-mcp's registry tests.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { FunctionRegistry } from './registry';

describe('FunctionRegistry', () => {
    it('should start empty', () => {
        const r = new FunctionRegistry();
        assert.strictEqual(r.size(), 0);
        assert.strictEqual(r.exists('test.foo'), false);
    });

    it('should register and look up by qualified name', () => {
        const r = new FunctionRegistry();
        r.add('main', 'test.main.main', 'Function');
        assert.strictEqual(r.size(), 1);
        assert.strictEqual(r.exists('test.main.main'), true);
        assert.strictEqual(r.labelOf('test.main.main'), 'Function');
    });

    it('should find by simple name', () => {
        const r = new FunctionRegistry();
        r.add('authenticate', 'test.auth.authenticate', 'Function');
        r.add('authenticate', 'test.middleware.authenticate', 'Method');

        const found = r.findByName('authenticate');
        assert.strictEqual(found.length, 2);
        assert.ok(found.includes('test.auth.authenticate'));
        assert.ok(found.includes('test.middleware.authenticate'));
    });

    it('should resolve via import_map strategy', () => {
        const r = new FunctionRegistry();
        r.add('queryUser', 'test.db.queryUser', 'Function');

        // Callee: "db.queryUser", import map: "db" → "test.db"
        const result = r.resolve(
            'db.queryUser',
            'test.auth',
            ['db'],
            ['test.db'],
        );

        assert.strictEqual(result.qualifiedName, 'test.db.queryUser');
        assert.strictEqual(result.strategy, 'import_map');
        assert.strictEqual(result.confidence, 0.95);
    });

    it('should resolve via import_map with bare callee name', () => {
        const r = new FunctionRegistry();
        // Register function: test.auth.requireAdmin
        r.add('requireAdmin', 'test.auth.requireAdmin', 'Function');

        // Callee: "requireAdmin" (bare name, no dot separator)
        // Import map: "requireAdmin" → "test.auth"
        // prefix = "requireAdmin", suffix = ""
        // candidate = "test.auth.requireAdmin" (resolved.prefix)
        const result = r.resolve(
            'requireAdmin',
            'test.handler',
            ['requireAdmin'],
            ['test.auth'],
        );

        assert.strictEqual(result.qualifiedName, 'test.auth.requireAdmin');
        assert.strictEqual(result.strategy, 'import_map');
    });

    it('should resolve via same_module strategy', () => {
        const r = new FunctionRegistry();
        r.add('helper', 'test.auth.helper', 'Function');

        const result = r.resolve(
            'helper',
            'test.auth',  // same module
            [], [],
        );

        assert.strictEqual(result.qualifiedName, 'test.auth.helper');
        assert.strictEqual(result.strategy, 'same_module');
        assert.strictEqual(result.confidence, 0.90);
    });

    it('should resolve via unique_name strategy', () => {
        const r = new FunctionRegistry();
        r.add('uniqueFunc', 'test.utils.uniqueFunc', 'Function');

        const result = r.resolve(
            'uniqueFunc',
            'test.other',
            [], [],
        );

        assert.strictEqual(result.qualifiedName, 'test.utils.uniqueFunc');
        assert.strictEqual(result.strategy, 'unique_name');
        assert.strictEqual(result.confidence, 0.75);
    });

    it('should resolve via unique_name with reduced confidence when not import-reachable', () => {
        const r = new FunctionRegistry();
        r.add('uniqueFunc', 'test.utils.uniqueFunc', 'Function');

        const result = r.resolve(
            'uniqueFunc',
            'test.other',
            [],          // no import keys
            ['test.foo'], // import values that don't match
        );

        assert.strictEqual(result.qualifiedName, 'test.utils.uniqueFunc');
        assert.strictEqual(result.strategy, 'unique_name');
        assert.strictEqual(result.confidence, 0.75 * 0.5); // Reduced
    });

    it('should resolve via suffix_match with import reachability', () => {
        const r = new FunctionRegistry();
        // Two functions with same name but different modules
        r.add('handle', 'test.auth.handle', 'Function');
        r.add('handle', 'test.middleware.handle', 'Function');

        // Import map includes test.auth, so test.auth.handle should be preferred
        const result = r.resolve(
            'handle',
            'test.handler',
            ['auth'],          // import keys
            ['test.auth'],     // import vals
        );

        assert.strictEqual(result.qualifiedName, 'test.auth.handle');
        assert.strictEqual(result.strategy, 'suffix_match');
    });

    it('should disambiguate via qualified_suffix with dotted callee', () => {
        const r = new FunctionRegistry();
        r.add('validate', 'test.auth.validate', 'Function');
        r.add('validate', 'test.payment.validate', 'Function');

        // "auth.validate" has a dotted prefix, should disambiguate
        const result = r.resolve(
            'auth.validate',
            'test.handler',
            [], [],
        );

        // The qualified suffix match should find test.auth.validate
        assert.strictEqual(result.qualifiedName, 'test.auth.validate');
        assert.strictEqual(result.strategy, 'qualified_suffix');
    });

    it('should return empty result for unknown callee', () => {
        const r = new FunctionRegistry();
        r.add('foo', 'test.foo', 'Function');

        const result = r.resolve('nonexistent', 'test.module', [], []);
        assert.strictEqual(result.qualifiedName, '');
        assert.strictEqual(result.confidence, 0);
    });

    it('should return empty result for too many candidates', () => {
        const r = new FunctionRegistry();
        // Register 300+ functions with the same name
        for (let i = 0; i < 300; i++) {
            r.add('handle', `test.pkg${i}.handle`, 'Function');
        }

        const result = r.resolve('handle', 'test.module', [], []);
        assert.strictEqual(result.qualifiedName, '');
    });

    it('should fuzzy resolve with single candidate', () => {
        const r = new FunctionRegistry();
        r.add('uniqueFunc', 'test.utils.uniqueFunc', 'Function');

        const result = r.fuzzyResolve('uniqueFunc', 'test.other', [], []);
        assert.strictEqual(result.resolved, true);
        assert.strictEqual(result.qualifiedName, 'test.utils.uniqueFunc');
        assert.strictEqual(result.confidence, 0.40);
    });

    it('should fuzzy resolve with import filtering', () => {
        const r = new FunctionRegistry();
        r.add('handle', 'test.auth.handle', 'Function');
        r.add('handle', 'test.middleware.handle', 'Function');

        const result = r.fuzzyResolve(
            'handle',
            'test.handler',
            ['auth'],
            ['test.auth'],
        );

        assert.strictEqual(result.resolved, true);
        assert.strictEqual(result.qualifiedName, 'test.auth.handle');
    });

    it('should clear all entries', () => {
        const r = new FunctionRegistry();
        r.add('foo', 'test.foo', 'Function');
        r.add('bar', 'test.bar', 'Function');
        assert.strictEqual(r.size(), 2);

        r.clear();
        assert.strictEqual(r.size(), 0);
    });

    it('should handle Rust-style :: separator', () => {
        const r = new FunctionRegistry();
        r.add('square', 'test.lib.square', 'Function');

        const result = r.resolve(
            'lib::square',
            'test.main',
            ['lib'],
            ['test.lib'],
        );

        assert.strictEqual(result.qualifiedName, 'test.lib.square');
        assert.strictEqual(result.strategy, 'import_map');
    });

    it('should prefer non-test over test code', () => {
        const r = new FunctionRegistry();
        r.add('handle', 'test.auth.TestHandle', 'Function');
        r.add('handle', 'test.auth.handle', 'Function');

        const result = r.resolve('handle', 'test.handler', [], []);
        // Should prefer the non-test version
        assert.strictEqual(result.qualifiedName, 'test.auth.handle');
    });

    it('should prefer same-package proximity', () => {
        const r = new FunctionRegistry();
        r.add('helper', 'test.auth.sub.helper', 'Function');
        r.add('helper', 'test.payment.helper', 'Function');

        const result = r.resolve('helper', 'test.auth.other', [], []);
        // test.auth.sub.helper has more common prefix with test.auth.other
        assert.strictEqual(result.qualifiedName, 'test.auth.sub.helper');
    });
});