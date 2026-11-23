import { parse } from 'acorn';

/**
 * Safely turns the game's wiki data module (`const e={...};export{e as default};`)
 * into a plain value WITHOUT executing it. Only literal syntax is accepted:
 * objects, arrays, strings/numbers/booleans/null, `!0`/`!1`, unary minus and
 * template strings without expressions. Anything else throws.
 */
export function parseDataModule(source: string): unknown {
  const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }) as any;
  const decl = program.body.find((n: any) => n.type === 'VariableDeclaration');
  if (!decl || decl.declarations.length !== 1) throw new Error('No data declaration found in the wiki module.');
  return evalLiteral(decl.declarations[0].init);
}

/**
 * Every declarator of the module's first declaration (`const e={…},d={…};function a(p){…}`), as plain
 * values by name. Same literal-only rules: the rest of the module (functions, exports) is ignored, never run.
 */
export function parseDataDeclarations(source: string): Record<string, unknown> {
  const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }) as any;
  const decl = program.body.find((n: any) => n.type === 'VariableDeclaration');
  if (!decl) throw new Error('No data declaration found in the wiki module.');
  const out: Record<string, unknown> = {};
  for (const d of decl.declarations) if (d.id.type === 'Identifier' && d.init) out[d.id.name] = evalLiteral(d.init);
  return out;
}

function evalLiteral(node: any): unknown {
  switch (node.type) {
    case 'ObjectExpression': {
      const out: Record<string, unknown> = {};
      for (const p of node.properties) {
        if (p.type !== 'Property' || p.computed || p.kind !== 'init') throw new Error('Invalid property: ' + p.type);
        const key = p.key.type === 'Identifier' ? p.key.name : String(p.key.value);
        out[key] = evalLiteral(p.value);
      }
      return out;
    }
    case 'ArrayExpression':
      return node.elements.map((el: any) => (el === null ? null : evalLiteral(el)));
    case 'Literal':
      if (node.regex) throw new Error('Regex literals are not supported');
      return node.value;
    case 'UnaryExpression': {
      const v = evalLiteral(node.argument);
      if (node.operator === '!') return !v;
      if (node.operator === '-') return -(v as number);
      if (node.operator === '+') return +(v as number);
      throw new Error('Unsupported operator: ' + node.operator);
    }
    case 'TemplateLiteral':
      if (node.expressions.length) throw new Error('Template has expressions – not plain data');
      return node.quasis.map((q: any) => q.value.cooked).join('');
    default:
      throw new Error('Not plain data syntax: ' + node.type);
  }
}
