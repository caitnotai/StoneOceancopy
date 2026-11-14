// Prints how many BodyParts3D parts land in each body system, and what is left out.
// Usage: node tools/bodyparts/report.mjs <dir with the BodyParts3D lists>
import { classify, loadElements } from './classify.mjs';

const elements = loadElements(process.argv[2]);
const groups = new Map();
const skipped = new Map();
for (const element of elements.values()) {
  const target = classify(element);
  if (!target) {
    skipped.set(element.name, (skipped.get(element.name) ?? 0) + 1);
    continue;
  }
  const key = `${target.system}/${target.part}`;
  if (!groups.has(key)) groups.set(key, new Map());
  groups.get(key).set(element.name, (groups.get(key).get(element.name) ?? 0) + 1);
}

for (const [key, names] of [...groups].sort()) {
  const total = [...names.values()].reduce((a, b) => a + b, 0);
  console.log(`\n${key}: ${total} elements, ${names.size} names`);
  console.log('  ' + [...names.keys()].sort().slice(0, 60).join(' | ').slice(0, 1400));
}
const skippedTotal = [...skipped.values()].reduce((a, b) => a + b, 0);
console.log(`\nSKIPPED: ${skippedTotal} elements`);
console.log('  ' + [...skipped.keys()].sort().join(' | '));
