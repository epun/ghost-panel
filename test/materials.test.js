import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  assignMaterial,
  collectSceneMaterials,
  groupIndexForFace,
  materialLabel,
  materialSignature,
  slotForIntersection,
} from '../materials.js';

/** A box has six geometry groups, one per face — our per-face drop target. */
function box(name, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.name = name;
  return mesh;
}

describe('materialLabel', () => {
  it('prefers an explicit name', () => {
    const m = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
    m.name = 'Brass';
    expect(materialLabel(m)).toBe('Brass');
  });

  it('falls back to an RGB label derived from the sRGB base color', () => {
    const m = new THREE.MeshBasicMaterial({ color: 0xff8000 });
    expect(materialLabel(m)).toBe('RGB_255-128-0');
  });

  it('falls back to the type when there is no color at all', () => {
    const m = new THREE.MeshNormalMaterial();
    expect(materialLabel(m)).toBe('MeshNormalMaterial');
  });

  it('handles a missing material', () => {
    expect(materialLabel(null)).toBe('None');
  });
});

describe('materialSignature', () => {
  it('changes when a visual property changes', () => {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const before = materialSignature(m);
    m.roughness = 0.9;
    expect(materialSignature(m)).not.toBe(before);
  });

  it('is stable when nothing visual changed', () => {
    const m = new THREE.MeshStandardMaterial({ color: 0x123456 });
    expect(materialSignature(m)).toBe(materialSignature(m));
  });

  it('ignores the material name, so renaming does not re-render the preview', () => {
    const m = new THREE.MeshStandardMaterial({ color: 0x123456 });
    const before = materialSignature(m);
    m.name = 'Renamed';
    expect(materialSignature(m)).toBe(before);
  });
});

describe('collectSceneMaterials', () => {
  it('indexes materials by instance and records every user', () => {
    const scene = new THREE.Scene();
    const shared = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const own = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
    scene.add(box('a', shared), box('b', shared), box('c', own));

    const map = collectSceneMaterials(scene);
    expect(map.size).toBe(2);
    expect(map.get(shared).users.map(u => u.mesh.name)).toEqual(['a', 'b']);
    expect(map.get(own).users).toHaveLength(1);
    expect(map.get(own).users[0].slot).toBeNull();
  });

  it('records the slot index for multi-material meshes', () => {
    const scene = new THREE.Scene();
    const mats = [
      new THREE.MeshBasicMaterial({ color: 0x111111 }),
      new THREE.MeshBasicMaterial({ color: 0x222222 }),
    ];
    scene.add(box('multi', mats));

    const map = collectSceneMaterials(scene);
    expect(map.get(mats[0]).users[0].slot).toBe(0);
    expect(map.get(mats[1]).users[0].slot).toBe(1);
  });

  it('skips helpers and nodes opted out via userData.__duiIgnore', () => {
    const scene = new THREE.Scene();
    const hidden = new THREE.MeshStandardMaterial({ color: 0x0000ff });
    const ignored = box('ignored', hidden);
    ignored.userData.__duiIgnore = true;
    scene.add(ignored);
    scene.add(new THREE.BoxHelper(box('probe', new THREE.MeshBasicMaterial())));

    expect(collectSceneMaterials(scene).size).toBe(0);
  });

  it('skips descendants of an ignored parent', () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    group.userData.__duiIgnore = true;
    group.add(box('child', new THREE.MeshStandardMaterial()));
    scene.add(group);

    expect(collectSceneMaterials(scene).size).toBe(0);
  });

  it('tolerates a missing scene', () => {
    expect(collectSceneMaterials(null).size).toBe(0);
  });
});

describe('groupIndexForFace', () => {
  it('maps a face index onto the geometry group that contains it', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    // Each box face is two triangles → group N covers faces 2N and 2N+1.
    expect(groupIndexForFace(geo, 0)).toBe(0);
    expect(groupIndexForFace(geo, 1)).toBe(0);
    expect(groupIndexForFace(geo, 2)).toBe(1);
    expect(groupIndexForFace(geo, 11)).toBe(5);
  });

  it('returns null for ungrouped geometry', () => {
    expect(groupIndexForFace(new THREE.SphereGeometry(1), 3)).toBeNull();
    expect(groupIndexForFace(null, 0)).toBeNull();
  });
});

describe('slotForIntersection', () => {
  it('reads the materialIndex Three.js tags onto multi-material hits', () => {
    const mesh = box('multi', [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()]);
    const slot = slotForIntersection({ object: mesh, face: { materialIndex: 1 }, faceIndex: 4 });
    expect(slot).toBe(1);
  });

  it('derives the slot from geometry groups for a single-material mesh', () => {
    // Three.js does not tag face.materialIndex until a mesh is multi-material,
    // so a plain box still has to resolve to a face group on its own.
    const mesh = box('single', new THREE.MeshStandardMaterial());
    expect(slotForIntersection({ object: mesh, face: {}, faceIndex: 4 })).toBe(2);
  });

  it('returns null when the geometry has no groups', () => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshStandardMaterial());
    expect(slotForIntersection({ object: mesh, face: {}, faceIndex: 3 })).toBeNull();
    expect(slotForIntersection(null)).toBeNull();
  });
});

describe('assignMaterial', () => {
  it('re-skins the whole mesh and undoes cleanly', () => {
    const before = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const next = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const mesh = box('cube', before);

    const result = assignMaterial(mesh, next);
    expect(mesh.material).toBe(next);

    result.undo();
    expect(mesh.material).toBe(before);
  });

  it('re-skins every mesh under a group', () => {
    const group = new THREE.Group();
    const a = box('a', new THREE.MeshStandardMaterial());
    const b = box('b', new THREE.MeshStandardMaterial());
    group.add(a, b);
    const next = new THREE.MeshStandardMaterial({ color: 0x333333 });

    const result = assignMaterial(group, next);
    expect(result.meshes).toHaveLength(2);
    expect(a.material).toBe(next);
    expect(b.material).toBe(next);

    result.undo();
    expect(a.material).not.toBe(next);
    expect(b.material).not.toBe(next);
  });

  it('expands a single material into per-group slots when dropping on one face', () => {
    const base = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const next = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const mesh = box('cube', base);

    assignMaterial(mesh, next, { slot: 2 });

    expect(Array.isArray(mesh.material)).toBe(true);
    expect(mesh.material).toHaveLength(6);      // one slot per box face
    expect(mesh.material[2]).toBe(next);
    // Every other face keeps the material it already had.
    expect(mesh.material.filter(m => m === base)).toHaveLength(5);
  });

  it('collapses back to the original single material on undo', () => {
    const base = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const mesh = box('cube', base);

    const result = assignMaterial(mesh, new THREE.MeshStandardMaterial(), { slot: 0 });
    result.undo();

    expect(mesh.material).toBe(base);
    expect(Array.isArray(mesh.material)).toBe(false);
  });

  it('writes a single slot of an already multi-material mesh', () => {
    const mats = [
      new THREE.MeshBasicMaterial({ color: 0x111111 }),
      new THREE.MeshBasicMaterial({ color: 0x222222 }),
    ];
    const next = new THREE.MeshBasicMaterial({ color: 0x333333 });
    const mesh = box('multi', mats);

    const result = assignMaterial(mesh, next, { slot: 1 });
    expect(mesh.material[0]).toBe(mats[0]);
    expect(mesh.material[1]).toBe(next);

    result.undo();
    expect(mesh.material[1]).toBe(mats[1]);
  });

  it('fills every slot of a multi-material mesh when assigning the whole object', () => {
    const mesh = box('multi', [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()]);
    const next = new THREE.MeshBasicMaterial();

    assignMaterial(mesh, next);
    expect(mesh.material).toEqual([next, next]);
  });

  it('returns null when there is nothing to assign to', () => {
    expect(assignMaterial(null, new THREE.MeshBasicMaterial())).toBeNull();
    expect(assignMaterial(new THREE.Mesh(), null)).toBeNull();
    expect(assignMaterial(new THREE.Group(), new THREE.MeshBasicMaterial())).toBeNull();
  });
});
