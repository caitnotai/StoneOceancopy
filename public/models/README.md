# body.glb

Anatomical body model used by the 3D view. It is a derivative of **BodyParts3D**.

> BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.

- Source: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html
  (`isa_BP3D_4.0_obj_99.zip`, release 4.0, FMA 3.0 IS-A tree)
- Licence page (last updated 2025-02-27): https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html

## What was changed

`tools/build-body-model.mjs` produces this file from the original OBJ meshes:

- about 2,140 of the 2,234 element meshes are kept and grouped into the app's nine body
  systems, using the atlas's own FMA classification (`tools/bodyparts/classify.mjs`);
  urinary, reproductive and endocrine parts, hair, ligaments and membranes are left out;
- duplicated seam vertices are welded and every mesh is simplified (about 6.4 million
  triangles down to about 0.7 million);
- the body is rescaled from 1.72 m to 1.76 m and moved into the app's coordinate frame;
- each lung is added as the convex hull of its bronchi and vessels, because the atlas does
  not model the lung surface.

Lymph nodes and inner ears are not in the atlas; the app draws them at run time.

## Licence of this file

`body.glb` is offered under the same terms as its source: CC BY 4.0, with the attribution
above. Note that the comment header inside the 2011 OBJ files still names the earlier
licence, CC BY-SA 2.1 Japan. If you redistribute this model, keeping it under these same
terms and keeping the attribution satisfies both.
