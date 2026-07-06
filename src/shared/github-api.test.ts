import { afterEach, describe, expect, it, vi } from "vitest";
import {
  commitMultipleFiles,
  ConflictError
} from "./github-api";

describe("commitMultipleFiles", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates one commit containing all files and updates the branch", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")

      //GET branch ref
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            object: { sha: "current-commit-sha" }
          }),
          { status: 200 }
        )
      )

      //POST tree
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sha: "new-tree-sha"
          }),
          { status: 201 }
        )
      )

      //POST commit
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sha: "new-commit-sha"
          }),
          { status: 201 }
        )
      )

      //PATCH ref
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            object: { sha: "new-commit-sha" }
          }),
          { status: 200 }
        )
      );

    const files = [
      {
        path: "solutions/Arrays/two-sum.cpp",
        content: "int main() {}"
      },
      {
        path: "solutions/Arrays/two-sum.md",
        content: "# Two Sum"
      },
      {
        path: "stats/stats.json",
        content: '{"total_solved":1}'
      },
      {
        path: "README.md",
        content: "# AlgoNest"
      }
    ];

    const result = await commitMultipleFiles(
      "fake-token",
      "owner/repo",
      "main",
      files,
      "Solve two-sum"
    );

    expect(result).toBe("new-commit-sha");

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("sends all files as plain content in one tree", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            object: { sha: "base-sha" }
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sha: "tree-sha"
          }),
          { status: 201 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sha: "commit-sha"
          }),
          { status: 201 }
        )
      )
      .mockResolvedValueOnce(
        new Response("{}", { status: 200 })
      );

    const files = [
      {
        path: "hello.cpp",
        content: "// 你好 🌍"
      },
      {
        path: "README.md",
        content: "# Hello"
      }
    ];

    await commitMultipleFiles(
      "fake-token",
      "owner/repo",
      "main",
      files,
      "Test commit"
    );

    const [, treeRequest] = fetchMock.mock.calls;

    const treeBody = JSON.parse(
      String(treeRequest[1]?.body)
    );

    expect(treeBody).toEqual({
      base_tree: "base-sha",
      tree: [
        {
          path: "hello.cpp",
          mode: "100644",
          type: "blob",
          content: "// 你好 🌍"
        },
        {
          path: "README.md",
          mode: "100644",
          type: "blob",
          content: "# Hello"
        }
      ]
    });
  });

  it("creates the commit with the new tree and current commit as parent", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            object: { sha: "base-sha" }
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sha: "tree-sha"
          }),
          { status: 201 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sha: "commit-sha"
          }),
          { status: 201 }
        )
      )
      .mockResolvedValueOnce(
        new Response("{}", { status: 200 })
      );

    await commitMultipleFiles(
      "fake-token",
      "owner/repo",
      "main",
      [{ path: "README.md", content: "hello" }],
      "My commit"
    );

    const [, , commitRequest] = fetchMock.mock.calls;

    const commitBody = JSON.parse(
      String(commitRequest[1]?.body)
    );

    expect(commitBody).toEqual({
      message: "My commit",
      tree: "tree-sha",
      parents: ["base-sha"]
    });
  });

  it("updates the branch without force pushing", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            object: { sha: "base-sha" }
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sha: "tree-sha"
          }),
          { status: 201 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sha: "commit-sha"
          }),
          { status: 201 }
        )
      )
      .mockResolvedValueOnce(
        new Response("{}", { status: 200 })
      );

    await commitMultipleFiles(
      "fake-token",
      "owner/repo",
      "main",
      [{ path: "README.md", content: "hello" }],
      "My commit"
    );

    const [, , , refRequest] = fetchMock.mock.calls;

    const refBody = JSON.parse(
      String(refRequest[1]?.body)
    );

    expect(refBody).toEqual({
      sha: "commit-sha",
      force: false
    });
  });

  it("throws ConflictError when branch update returns 422", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            object: { sha: "base-sha" }
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sha: "tree-sha"
          }),
          { status: 201 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sha: "commit-sha"
          }),
          { status: 201 }
        )
      )
      .mockResolvedValueOnce(
        new Response("{}", { status: 422 })
      );

    await expect(
      commitMultipleFiles(
        "fake-token",
        "owner/repo",
        "main",
        [{ path: "README.md", content: "hello" }],
        "My commit"
      )
    ).rejects.toBeInstanceOf(ConflictError);
  });
});