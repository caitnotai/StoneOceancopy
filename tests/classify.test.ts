import { describe, expect, it } from 'vitest';
import { SYSTEM_IDS } from '../src/domain/types';
import { classify, lungSide, type AtlasElement } from '../tools/bodyparts/classify.mjs';

const part = (name: string, isa: string[] = [], partof: string[] = []): AtlasElement => ({
  name,
  isa: new Set(isa),
  partof: new Set(partof),
});
const keyOf = (element: AtlasElement): string | null => {
  const target = classify(element);
  return target ? `${target.system}/${target.part}` : null;
};

describe('atlas part -> body system', () => {
  it('assigns typical parts to the expected system', () => {
    expect(keyOf(part('skin'))).toBe('radiation/skin');
    expect(keyOf(part('left femur', ['bone organ', 'long bone']))).toBe('skeletal/bones');
    expect(keyOf(part('left fifth costal cartilage', ['cartilage organ component']))).toBe('skeletal/bones');
    expect(keyOf(part('intervertebral disk of axis'))).toBe('skeletal/bones');
    expect(keyOf(part('right gluteus maximus', ['muscle organ', 'muscle of lower limb']))).toBe('muscular/muscles');
    expect(keyOf(part('lateral head of left gastrocnemius', ['head of muscle organ']))).toBe('muscular/muscles');
    expect(keyOf(part('descending part of left trapezius'))).toBe('muscular/muscles');
    expect(keyOf(part('left brachial artery', ['region of vascular tree organ']))).toBe('cardiovascular/vessels');
    expect(keyOf(part('trachea', [], ['respiratory system']))).toBe('respiratory/airways');
    expect(keyOf(part('left angular gyrus', ['gyrus of neuraxis'], ['nervous system', 'brain']))).toBe('neuro/brain');
    expect(keyOf(part('spleen'))).toBe('immune/lymphoid');
    expect(keyOf(part('stomach', [], ['alimentary system']))).toBe('metabolic/organs');
  });

  it('resolves parts that could belong to two systems', () => {
    // A papillary muscle is muscle tissue, but it is part of the heart and beats with it.
    expect(keyOf(part('anterior papillary muscle of right ventricle', ['muscle organ'], ['heart']))).toBe('cardiovascular/heart');
    // The portal vein runs inside the liver, but it is a vessel.
    expect(keyOf(part('left portal vein', ['vein'], ['alimentary system', 'liver']))).toBe('cardiovascular/vessels');
    // The optic nerve belongs with the eyes: it is what SANS monitoring looks at.
    expect(keyOf(part('left optic nerve', ['nerve', 'optic nerve']))).toBe('sensory/eyes');
    // The lacrimal bone is a bone even though lacrimal glands are left out.
    expect(keyOf(part('left lacrimal bone', ['bone organ']))).toBe('skeletal/bones');
    // Ventricles of the brain are not ventricles of the heart.
    expect(keyOf(part('left lateral ventricle', ['region of ventricular system of neuraxis'], ['nervous system']))).toBe('neuro/brain');
  });

  it('leaves out systems the app does not track', () => {
    expect(keyOf(part('left kidney', [], ['urinary system']))).toBeNull();
    expect(keyOf(part('hair of head', ['hair']))).toBeNull();
    expect(keyOf(part('region of dura mater'))).toBeNull();
    expect(keyOf(part('something unknown'))).toBeNull();
  });

  it('only produces systems the app knows', () => {
    const samples = [part('skin'), part('x', ['bone organ']), part('y', ['muscle organ']), part('z', ['artery']), part('spleen')];
    for (const sample of samples) expect(SYSTEM_IDS).toContain(classify(sample)!.system);
  });

  it('tells which lung a part outlines', () => {
    expect(lungSide(part('left apical segmental bronchial tree', [], ['left lung']))).toBe('left');
    expect(lungSide(part('right anterior segmental artery', [], ['right lung']))).toBe('right');
    expect(lungSide(part('left femur'))).toBeNull();
  });
});
