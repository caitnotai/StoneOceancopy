export interface AtlasElement {
  /** The part's own (most specific) name. */
  name: string;
  /** Names of every IS-A ancestor (what the part is). */
  isa: Set<string>;
  /** Names of every PART-OF ancestor (where the part sits). */
  partof: Set<string>;
}

export function loadElements(dir: string): Map<string, AtlasElement>;
export function classify(element: AtlasElement): { system: string; part: string } | null;
export function lungSide(element: AtlasElement): 'left' | 'right' | null;
