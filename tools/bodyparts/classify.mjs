// Maps BodyParts3D element files to the app's body systems.
//
// BodyParts3D ships ~2,200 "element" meshes (FJxxxx.obj) plus two trees taken from the
// Foundational Model of Anatomy (FMA): IS-A (what a part is) and PART-OF (where it sits).
// A part is assigned to a system by the first rule that matches its own name or any of
// its ancestors in those trees. Order matters: e.g. a papillary muscle is heart, not muscle.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** compound name -> Set(element id) */
function loadCompounds(file) {
  const map = new Map();
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/).slice(1)) {
    const [, name, element] = line.split('\t');
    if (!element) continue;
    if (!map.has(name)) map.set(name, new Set());
    map.get(name).add(element.trim());
  }
  return map;
}

/** @returns {Map<string, {name: string, isa: Set<string>, partof: Set<string>}>} element id -> names */
export function loadElements(dir) {
  const isa = loadCompounds(join(dir, 'isa_element_parts.txt'));
  const partof = loadCompounds(join(dir, 'partof_element_parts.txt'));
  const elements = new Map();
  const smallest = new Map();
  const visit = (compounds, key) => {
    for (const [name, members] of compounds) {
      for (const id of members) {
        if (!elements.has(id)) elements.set(id, { name: id, isa: new Set(), partof: new Set() });
        elements.get(id)[key].add(name);
        // The compound with the fewest members is the part's own (most specific) name.
        if (key === 'isa' && (!smallest.has(id) || members.size < smallest.get(id))) {
          smallest.set(id, members.size);
          elements.get(id).name = name;
        }
      }
    }
  };
  visit(isa, 'isa');
  visit(partof, 'partof');
  return elements;
}

const has = (set, ...names) => names.some((n) => set.has(n));
const anyMatch = (set, pattern) => [...set].some((n) => pattern.test(n));

/**
 * Ordered rules: [system, part, predicate]. A `null` system means "deliberately left out":
 * systems the app does not track (urinary, reproductive, endocrine), hair, and membranes
 * that would only hide what is underneath.
 */
const RULES = [
  ['radiation', 'skin', (e) => e.name === 'skin'],

  ['skeletal', 'bones', (e) => has(e.isa, 'bone organ', 'tooth') || /costal cartilage|sternum|manubrium|xiphoid|intervertebral disk/.test(e.name)],

  [null, null, (e) => /hair|eyebrow|external ear|mons pubis|penis|testis|epididymis|deferent|seminal|scrotum|prostate|urethra|ureter|kidney|urinary bladder|adrenal|pituitary|pineal|lacrimal|gingiva|nasal cartilage|alar cartilage|dura mater|subarachnoid|eyelid|interosseous membrane|retinaculum|ligament|raphe|membrane|conus elasticus|conduit space|subdivision of mouth/.test(e.name)],
  [null, null, (e) => has(e.partof, 'genital system', 'urinary system')],

  ['sensory', 'eyes', (e) => has(e.partof, 'left eyeball', 'right eyeball') || /eyeball|corona ciliaris|optic (nerve|tract|chiasm)|vitreous|\b(lens|cornea|sclera|iris|retina)\b/.test(e.name)],

  // Heart first, so its own vessels and papillary muscles beat with it.
  ['cardiovascular', 'heart', (e) => has(e.partof, 'heart') || has(e.isa, 'region of wall of heart', 'cavity of cardiac chamber', 'cusp of cardiac valve', 'leaf of cardiac valve') || /wall of ventricle/.test(e.name)],
  ['cardiovascular', 'vessels', (e) => has(e.isa, 'artery', 'vein', 'vascular tree', 'region of vascular tree organ') || has(e.partof, 'cardiovascular system') || /arter|\bveins?\b|venous|aorta|vena cava|palmar arch|plantar arch/.test(e.name)],

  ['respiratory', 'airways', (e) => has(e.isa, 'segment of tracheobronchial tree') || /trachea|bronch|cricoid|thyroid cartilage|epiglott|arytenoid cartilage|corniculate|cuneiform cartilage/.test(e.name)],

  ['neuro', 'brain', (e) => has(e.partof, 'nervous system') || has(e.isa, 'nerve') || anyMatch(e.isa, /neuraxis|telencephalon|diencephalon|metencephalon/) || /cerebell|spinal cord|medulla oblongata|\bpons\b|midbrain|cerebral hemisphere|choroid plexus|\bnerve\b|ganglion|decussation/.test(e.name)],

  ['immune', 'lymphoid', (e) => /spleen|thymus/.test(e.name)],

  ['muscular', 'muscles', (e) => anyMatch(e.isa, /\bmuscle\b|tendon/) || /tendon|iliotibial tract|aponeurosis|diaphragm|trapezius|interossei|lumbricals|intertransversarii|interspinales|levatores|tendinous ring|trochlea of/.test(e.name)],

  ['metabolic', 'organs', (e) => has(e.partof, 'alimentary system') || /esophagus|stomach|duodenum|jejunum|ileum|colon|cecum|appendix|rectum|liver|hepat|gallbladder|biliary|bile duct|cystic duct|pancrea|tongue|pharynx|sublingual|submandibular/.test(e.name)],
];

/** @returns {{system: string, part: string} | null} */
export function classify(element) {
  for (const [system, part, test] of RULES) {
    if (test(element)) return system ? { system, part } : null;
  }
  return null;
}

/** Elements whose vertices outline each lung (BodyParts3D has the bronchi and vessels, not the lung surface). */
export const lungSide = (element) =>
  element.partof.has('left lung') ? 'left' : element.partof.has('right lung') ? 'right' : null;
