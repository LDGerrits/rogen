const fs = require("fs");
const path = require("path");

const toPosix = (p) => p.split(path.sep).join("/");

function getOrCreateNode(parent, key, className) {
    if (!parent[key]) {
        parent[key] = className == null ? {} : { "$className": className };
    }
    return parent[key];
}

function pruneObject(node, buildDir) {
    for (const key in node) {
        const val = node[key];
        if (typeof val !== "object" || val === null) continue;

        if (val.$path) {
            if (val.$path.startsWith(buildDir)) continue; 
            if (!fs.existsSync(path.resolve(process.cwd(), val.$path))) {
                delete node[key];
                continue;
            }
        }
        pruneObject(val, buildDir);
    }
    return node;
}

function sortObject(obj) {
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return obj;
    return Object.keys(obj)
        .sort()
        .reduce((acc, key) => {
            acc[key] = sortObject(obj[key]);
            return acc;
        }, {});
}

function findMissingPaths(node, buildDir, missing = []) {
    for (const key in node) {
        const val = node[key];
        if (typeof val !== "object" || val === null) continue;

        if (val.$path && val.$path.startsWith(buildDir)) {
            const absolutePath = path.resolve(process.cwd(), val.$path);
            if (!fs.existsSync(absolutePath)) {
                missing.push({ parent: node, key, path: val.$path, absolutePath });
            }
        }
        findMissingPaths(val, buildDir, missing);
    }
    return missing;
}

module.exports = { toPosix, getOrCreateNode, pruneObject, sortObject, findMissingPaths };