#!/usr/bin/env python3
"""Export cut-part sizes/counts from a SketchUp SKP using OpenSKP.

Install once: python -m pip install 'openskp>=1.0'
Run: python extract_skp_parts.py 'playroom cabinets (1).skp'

Dimensions are in inches and normalized as length >= width >= thickness.
The main parts CSV preserves the browser planner schema.
"""

import argparse
import collections
import csv
import math
from pathlib import Path

IDENTITY = ((1.0, 0.0, 0.0, 0.0), (0.0, 1.0, 0.0, 0.0), (0.0, 0.0, 1.0, 0.0), (0.0, 0.0, 0.0, 1.0))
KNOWN_ASSEMBLIES = {"Cabinet Box (large)", "Cabinet Box (small)", "Cab Base (large)", "Cab Base (small)"}


def mat_from_instance(matrix):
    """Normalize known OpenSKP transform layouts into a 4x4 matrix."""
    if len(matrix) == 4 and all(hasattr(row, "__len__") and len(row) == 4 for row in matrix):
        return tuple(tuple(float(matrix[i][j]) for j in range(4)) for i in range(4))
    if len(matrix) == 13:
        scale = matrix[12]
        return (
            (scale * matrix[0], scale * matrix[1], scale * matrix[2], matrix[9]),
            (scale * matrix[3], scale * matrix[4], scale * matrix[5], matrix[10]),
            (scale * matrix[6], scale * matrix[7], scale * matrix[8], matrix[11]),
            (0.0, 0.0, 0.0, 1.0),
        )
    if len(matrix) == 12:
        return (
            (float(matrix[0]), float(matrix[1]), float(matrix[2]), float(matrix[9])),
            (float(matrix[3]), float(matrix[4]), float(matrix[5]), float(matrix[10])),
            (float(matrix[6]), float(matrix[7]), float(matrix[8]), float(matrix[11])),
            (0.0, 0.0, 0.0, 1.0),
        )
    if len(matrix) == 16:
        return tuple(tuple(float(matrix[4 * i + j]) for j in range(4)) for i in range(4))
    raise ValueError(f"Unsupported instance matrix length {len(matrix)}")


def multiply(left, right):
    return tuple(tuple(sum(left[i][k] * right[k][j] for k in range(4)) for j in range(4)) for i in range(4))


def norm_basis(matrix, column):
    return math.sqrt(sum(matrix[i][column] ** 2 for i in range(3)))


def linear_det(matrix):
    a = matrix
    return (
        a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
        - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
        + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
    )


def values_or_iterable(container):
    if hasattr(container, "values"):
        return list(container.values())
    return list(container)


def dimensions(definition, matrix):
    vertices = values_or_iterable(definition.vertices)
    if not vertices:
        return None
    spans = [max(getattr(v, axis) for v in vertices) - min(getattr(v, axis) for v in vertices) for axis in "xyz"]
    dims = sorted((max(0.0, spans[idx] * norm_basis(matrix, idx)) for idx in range(3)), reverse=True)
    return tuple(dims)


def is_sheared(matrix):
    basis = [[matrix[i][j] for i in range(3)] for j in range(3)]
    for i in range(3):
        for j in range(i + 1, 3):
            ni = math.sqrt(sum(x * x for x in basis[i]))
            nj = math.sqrt(sum(x * x for x in basis[j]))
            if ni * nj and abs(sum(x * y for x, y in zip(basis[i], basis[j])) / (ni * nj)) > 0.0001:
                return True
    return False


def has_solid_geometry(definition):
    return bool(definition.vertices and (definition.faces or definition.edges))


def definition_by_ref(definitions, ref_idx):
    if hasattr(definitions, "get"):
        return definitions.get(ref_idx)
    if isinstance(definitions, (list, tuple)) and 0 <= ref_idx < len(definitions):
        return definitions[ref_idx]
    return None


def extract(model):
    counts = collections.Counter()
    issues = collections.Counter()
    placements = []

    def record_issue(issue_type, path, definition_ref, note):
        issues[(issue_type, path, definition_ref, note)] += 1

    def walk(instance, parent_matrix, path, active_refs):
        definition = definition_by_ref(model.definitions, instance.ref_idx)
        if definition is None:
            record_issue("missing-definition", path, instance.ref_idx, "Definition index not found")
            return
        if instance.ref_idx in active_refs:
            record_issue("cycle", path, instance.ref_idx, "Recursive instance cycle detected")
            return

        name = (instance.name or definition.name or f"Unnamed #{instance.ref_idx}").strip()
        full_path = f"{path}/{name}"
        if getattr(instance, "hidden", False):
            record_issue("hidden-skipped", full_path, instance.ref_idx, "Hidden instance skipped")
            return

        matrix = multiply(parent_matrix, mat_from_instance(instance.matrix))
        child_instances = getattr(definition, "instances", [])
        has_geometry = has_solid_geometry(definition)

        if child_instances:
            if has_geometry:
                dims = dimensions(definition, matrix)
                dims_text = "unknown"
                if dims is not None:
                    dims_text = f"L={dims[0]:.5f}, W={dims[1]:.5f}, T={dims[2]:.5f}"
                record_issue(
                    "assembly-geometry-skipped",
                    full_path,
                    instance.ref_idx,
                    f"Assembly node has child instances and own geometry ({dims_text}); own geometry not exported as part",
                )
            for child in child_instances:
                walk(child, matrix, full_path, active_refs | {instance.ref_idx})
            return

        if not has_geometry:
            record_issue("empty", full_path, instance.ref_idx, "No geometry and no child instances")
            return

        if name in KNOWN_ASSEMBLIES:
            record_issue("assembly-without-children", full_path, instance.ref_idx, "Known assembly name appears as a leaf")
            return

        dims = dimensions(definition, matrix)
        if dims is None or dims[2] < 1e-5:
            record_issue("flat-or-empty", full_path, instance.ref_idx, f"Invalid dimensions {dims}")
            return

        length, width, thickness = dims
        key = (name, round(length, 5), round(width, 5), round(thickness, 5))
        counts[key] += 1

        sheared = is_sheared(matrix)
        mirrored = linear_det(matrix) < 0
        if sheared:
            record_issue("sheared-placement", full_path, instance.ref_idx, "Sheared transform; axis-scaled dimensions are approximate")

        placements.append(
            {
                "path": full_path,
                "name": name,
                "definition_ref": instance.ref_idx,
                "width": width,
                "length": length,
                "thickness": thickness,
                "sheared": sheared,
                "mirrored": mirrored,
            }
        )

    for instance in model.root.instances:
        walk(instance, IDENTITY, "Model", set())

    return counts, issues, placements


def write_csv(path, header, rows):
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("skp", type=Path)
    parser.add_argument("--output", type=Path, help="Output prefix, default SKP base name")
    parser.add_argument("--material", default="", help="Optional Cut Planner stock name, e.g. 3/4 Plywood")
    args = parser.parse_args()

    try:
        from openskp import SkpFile
    except ImportError:
        parser.error("OpenSKP not installed. Run: python -m pip install 'openskp>=1.0'")

    model = SkpFile.open(args.skp).parse()
    counts, issues, placements = extract(model)

    base = args.output or args.skp.with_suffix("")
    parts_csv = Path(str(base) + "-parts.csv")
    review_csv = Path(str(base) + "-review.csv")
    instances_csv = Path(str(base) + "-instances.csv")

    header = ["name", "width", "length", "thickness", "quantity", "material"]
    output_rows = []
    review_rows = []

    for (name, length, width, thickness), qty in sorted(counts.items()):
        values = [name, f"{width:.5f}", f"{length:.5f}", f"{thickness:.5f}", qty, args.material]
        output_rows.append(values)
        review_rows.append(values + ["OK", ""])

    issue_rows = []
    for (issue_type, path, definition_ref, note), count in sorted(issues.items()):
        issue_rows.append([
            "",
            "",
            "",
            "",
            "",
            "",
            f"REVIEW: {issue_type}",
            f"count={count}; ref={definition_ref}; path={path}; note={note}",
        ])

    instance_rows = [
        [
            row["path"],
            row["name"],
            row["definition_ref"],
            f"{row['width']:.5f}",
            f"{row['length']:.5f}",
            f"{row['thickness']:.5f}",
            int(row["sheared"]),
            int(row["mirrored"]),
        ]
        for row in placements
    ]

    write_csv(parts_csv, header, output_rows)
    write_csv(review_csv, header + ["status", "note"], review_rows + issue_rows)
    write_csv(
        instances_csv,
        ["path", "name", "definition_ref", "width", "length", "thickness", "sheared", "mirrored"],
        instance_rows,
    )

    total_parts = sum(counts.values())
    total_flags = sum(issues.values())
    print(
        f"Format: {model.version} | definition count: {len(model.definitions)} | top-level instances: {len(model.root.instances)}"
    )
    print(f"Part lines: {len(counts)} | total individual pieces: {total_parts} | review flags: {total_flags}")
    print("Parts CSV:   ", parts_csv)
    print("Review CSV:  ", review_csv)
    print("Instances CSV:", instances_csv)
    for (issue_type, path, definition_ref, note), count in sorted(issues.items())[:20]:
        print(f"CHECK: {issue_type} x{count} | ref={definition_ref} | {path} | {note}")
    if not counts:
        raise SystemExit("WARNING: no usable parts found; inspect review CSV")


if __name__ == "__main__":
    main()
