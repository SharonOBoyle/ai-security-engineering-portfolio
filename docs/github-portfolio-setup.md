# Setting Up a GitHub Portfolio from the Engenious Course Repository

> **About this guide:** I put this step-by-step guide together, with help from ChatGPT, after setting up a separate GitHub portfolio repository for my AI Security Engineer course work. I'm sharing it in case it's useful to anyone else who wants to do something similar.

## Goal

Set up Git so that the original **Engenious AI Security Engineer repository** remains the upstream source, while portfolio work is developed and published in a separate GitHub repository.

The resulting setup looks like this:

```text
Engenious course repository
          │
       upstream
          ↓
    Local repository
          │
        origin
          ↓
GitHub portfolio repository
```

This keeps the Engenious repository available for course updates while maintaining portfolio work in a separate repository.

## 1. Keep the existing working copy

If course work has already been completed in a clone of the Engenious repository, keep that copy rather than overwriting it.

For example:

```bash
mv AI-Security-Engineer AI-Security-Engineer-working
```

This preserves existing changes while a clean portfolio repository is established.

## 2. Make a clean clone of the Engenious repository

Clone the course repository again:

```bash
git clone https://github.com/engenious-inc/AI-Security-Engineer.git
cd AI-Security-Engineer
```

Check that the new clone is clean:

```bash
git status
```

The expected result is:

```text
nothing to commit, working tree clean
```

This provides a known clean starting point before portfolio work is added.

## 3. Rename the Engenious remote to `upstream`

A normal Git clone calls the repository it came from `origin`.

For this setup, rename it:

```bash
git remote rename origin upstream
```

Check the result:

```bash
git remote -v
```

The Engenious repository should now appear as `upstream`.

The intended convention is:

```text
upstream = Engenious course repository
origin   = portfolio repository
```

This keeps the source course repository and the portfolio destination clearly separated.

## 4. Create the portfolio repository on GitHub

Create a new GitHub repository for the portfolio, for example:

```text
ai-security-engineering-portfolio
```

If starting from the Engenious repository's existing history, leave the new repository **empty**:

- Don't add a README.
- Don't add `.gitignore`.
- Don't add a licence.

This avoids GitHub creating a separate initial Git history that would then need to be reconciled with the Engenious history.

## 5. Add the portfolio repository as `origin`

Copy the URL of the new GitHub repository and add it as another remote:

```bash
git remote add origin https://github.com/YOUR-USERNAME/ai-security-engineering-portfolio.git
```

Verify the setup:

```bash
git remote -v
```

There should now be two remotes:

```text
origin    → portfolio repository
upstream  → Engenious course repository
```

The local repository can therefore receive course updates from `upstream` while portfolio work is pushed to `origin`.

## 6. Set the Git identity for the portfolio

Check which name and email Git is currently using:

```bash
git config user.name
git config user.email
```

For a public portfolio, consider whether the configured email address should appear in the public Git history.

GitHub provides a private `noreply` email address for accounts using email privacy. If preferred, set that identity specifically for this repository:

```bash
git config --local user.name "YOUR NAME"
git config --local user.email "YOUR-NOREPLY-ADDRESS"
```

Verify it:

```bash
git config --local user.name
git config --local user.email
```

Using `--local` means the setting applies only to this repository and does not alter the Git identity used by other repositories.

## 7. Mark the original Engenious course baseline

Before adding portfolio work, an annotated Git tag can mark the exact point where the original Engenious repository ends and the portfolio additions begin:

```bash
git tag -a course-baseline \
  -m "Original Engenious AI Security Engineer course baseline before portfolio work"
```

Check the tag:

```bash
git show course-baseline --no-patch
```

The underlying commit should retain its **original author**, while the new tag identifies its **Tagger**.

Conceptually:

```text
Original Engenious history
          │
          ▼
    course-baseline
          │
          ▼
   Portfolio additions
```

This provides a transparent distinction between supplied course material and subsequent portfolio work.

## 8. Push the clean baseline to the portfolio

Push `main` to the portfolio repository:

```bash
git push -u origin main
```

Then push the baseline tag:

```bash
git push origin course-baseline
```

Check which remote the local `main` branch now tracks:

```bash
git branch -vv
```

It should show:

```text
[origin/main]
```

The portfolio repository is now the normal destination for portfolio work, while `upstream` remains available for Engenious course updates.

## 9. Do portfolio work on branches

Rather than working directly on `main`, create a branch for a substantial exercise, course day, or piece of work.

For example:

```bash
git switch -c day5-attacker-agent
```

Check it with:

```bash
git branch -vv
git status
```

When first created, the new branch and `main` point to the same commit. As commits are added, the working branch develops its own history.

Once the work is complete and reviewed, it can be merged back into `main`.

## 10. Optional: a portfolio workflow

Here's an approach I'm using that others might find useful if they're also using the repository as a portfolio:

**Learn → reason → implement → test → interpret → commit**

The idea is to make meaningful commits as the work develops, so the Git history shows some of the reasoning and learning process rather than only the finished exercise.

For example, a commit might capture a security hypothesis, an attack strategy, evidence criteria, or an improvement to an evaluator.

This isn't necessary for the Git setup above — it's just an approach I'm trying for my own portfolio.

## Provenance and upstream history

This portfolio is maintained separately from the course source, following the `upstream` / `origin` convention described above:

- **upstream** — the Engenious course repository, `engenious-inc/AI-Security-Engineer`.
- **origin** — this portfolio repository (Sharon O'Boyle's `ai-security-engineering-portfolio`).

The portfolio does not necessarily mirror upstream: course material is integrated selectively rather than wholesale.

One such selective integration is recorded here for traceability:

- Upstream commit `9e724414544a1c4d3a42d2a63dd7d9886fa0626f` ("ui changes and intake"), from the Engenious course repository, was cherry-picked into this portfolio.
- It became portfolio commit `e9d2e66`.
- That cherry-pick was made without `git cherry-pick -x`, so no `(cherry picked from commit …)` trailer was recorded on `e9d2e66`. The source commit SHA is documented here instead, rather than by rewriting existing Git history.