import unittest

from extract_skp_parts import IDENTITY, extract


IDENTITY_13 = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]


class Vertex:
    def __init__(self, x, y, z):
        self.x = x
        self.y = y
        self.z = z


class Definition:
    def __init__(self, name, vertices=None, instances=None, faces=True, edges=True):
        self.name = name
        self.vertices = {i: v for i, v in enumerate(vertices or [])}
        self.instances = instances or []
        self.faces = [1] if faces else []
        self.edges = [1] if edges else []


class Instance:
    def __init__(self, ref_idx, name=None, matrix=None, hidden=False):
        self.ref_idx = ref_idx
        self.name = name or ""
        self.matrix = matrix or IDENTITY_13
        self.hidden = hidden


class Root:
    def __init__(self, instances):
        self.instances = instances


class Model:
    def __init__(self, definitions, root_instances):
        self.definitions = definitions
        self.root = Root(root_instances)


def box_vertices(length, width, thickness):
    return [
        Vertex(0, 0, 0),
        Vertex(length, 0, 0),
        Vertex(0, width, 0),
        Vertex(0, 0, thickness),
        Vertex(length, width, thickness),
    ]


def scale_matrix_13(sx=1.0, sy=1.0, sz=1.0):
    return [sx, 0.0, 0.0, 0.0, sy, 0.0, 0.0, 0.0, sz, 0.0, 0.0, 0.0, 1.0]


class ExtractTests(unittest.TestCase):
    def test_recursively_counts_reused_leaf_components(self):
        part_def = Definition("Door Rail", vertices=box_vertices(14.0, 2.5, 0.5))
        assembly_def = Definition(
            "Door Assembly",
            vertices=[],
            faces=False,
            edges=False,
            instances=[Instance(1, "Door Rail"), Instance(1, "Door Rail")],
        )
        model = Model(definitions={1: part_def, 2: assembly_def}, root_instances=[Instance(2), Instance(2)])

        counts, issues, placements = extract(model)

        self.assertEqual(sum(counts.values()), 4)
        self.assertEqual(len(placements), 4)
        self.assertFalse(issues)

    def test_applies_instance_scaling_to_dimensions(self):
        part_def = Definition("Panel", vertices=box_vertices(10.0, 2.0, 0.75))
        model = Model(definitions={1: part_def}, root_instances=[Instance(1, matrix=scale_matrix_13(sx=2.0, sy=1.5, sz=1.0))])

        counts, issues, _ = extract(model)

        self.assertFalse(issues)
        self.assertEqual(len(counts), 1)
        (name, length, width, thickness), qty = next(iter(counts.items()))
        self.assertEqual(name, "Panel")
        self.assertEqual(qty, 1)
        self.assertAlmostEqual(length, 20.0, places=5)
        self.assertAlmostEqual(width, 3.0, places=5)
        self.assertAlmostEqual(thickness, 0.75, places=5)

    def test_flags_assembly_nodes_with_own_geometry(self):
        part_def = Definition("Shelf", vertices=box_vertices(20.0, 10.0, 0.75))
        mixed_def = Definition("Cabinet Box", vertices=box_vertices(30.0, 24.0, 0.75), instances=[Instance(1, "Shelf")])
        model = Model(definitions={1: part_def, 2: mixed_def}, root_instances=[Instance(2)])

        counts, issues, placements = extract(model)

        self.assertEqual(sum(counts.values()), 1)
        self.assertEqual(len(placements), 1)
        issue_types = {k[0] for k in issues.keys()}
        self.assertIn("assembly-geometry-skipped", issue_types)


if __name__ == "__main__":
    unittest.main()
