# Kera fictional care-home demo, October 18, 2026

All people and backgrounds in this dataset are fictional. Generated results are labeled as simulated and contain no photos or laboratory tests. The recovery backup also preserves earlier manually saved check-ins; those can include experimental model output.

## Start the video

1. Open http://localhost:4173 and select **Saved profiles**.
2. Select **Alex Morgan (Demo care worker)**, a registered nurse at fictional Maple Grove Senior Living.
3. Open **John > History**. Filter to Hemoglobin, then expand **Explore hemoglobin trends**.
4. John's 26 weekly Hb estimates are between 145 and 154 g/L. His last recorded check-in is October 11. He has no October 18 Hb or visual result.
5. Return to Dashboard and select **John > New check-in**.
6. For the scripted story, select **Save simulated demo check-in**. This visibly labeled simulation saves a 112 g/L estimate at the time of the click, records that John feels as usual, and recommends clinical review and a confirmatory blood test. The background explanation opens automatically. It does not call or change the real inference model.
7. Return to History to compare the lower simulated value with his earlier estimates.

The camera and upload flow also work normally. An actual photo returns the actual experimental model output; it is not forced to produce a lower result. The guest app at `/demo/` shares the same two reference methods and Nail Health Analysis label, with its own separate saved Demo history and no shared health background.

## Included data

- One worker, one organization and one facility.
- Twenty-one residents, ages 67 to 96, with varied conditions, medications and recent background.
- Twenty-six prior weekly dates, April 19 through October 11, plus October 18 for the 20 residents other than John.
- Both Hb and visual results on each saved date: 566 of each, 1,132 generated results total.
- Hb entries include three generated scan values, an average, units, contextual insights and a fictional-data warning.
- Visual entries include image-quality context, four categories of descriptive observations and contextual insights. No images were assessed.
- John has 52 results before his demo check-in. Each other resident has 54 generated records. The current backup also retains one earlier saved check-in, for 1,133 total records.

`kera-demo-backup.json` is an app-compatible, versioned workspace backup. `residents.csv` and `weekly-history.csv` can be opened in a spreadsheet. `john-pending-scenario.json` describes the unsaved scripted outcome and does not add it to John's history.

## Recovery and rehearsal

The dataset is saved in this project and separately in `~/Documents/Kera Demo Dataset - 2026-10-18/`, alongside a ZIP archive. Kera's working SQLite database is `web/.data/kera.sqlite`. A consistent copy of the pre-existing database was saved as `web/.data/before-demo-<timestamp>.sqlite` before installation. Existing workspaces were preserved.

To recover this fictional workspace, choose **Restore backup** on the sign-in page and select `kera-demo-backup.json`, then choose it through Saved profiles. Restoration validates the entire backup and rejects conflicting records rather than replacing current data. It does not remove records saved after the backup.

To rehearse again after saving John's simulated check-in, open that **SIMULATED demo scenario v1** result and use **Delete this result > Permanently delete result**. Leave his 26 historical weeks intact. Repeating the simulation on the same day without deleting it reopens the same saved result rather than duplicating it.

To regenerate the reproducible October 18 fixture from the repository root:

```sh
node web/scripts/demo-dataset.mjs
```

To add it to a database (existing records are preserved and conflicting records are rejected):

```sh
node web/scripts/demo-dataset.mjs web/demo-data --install web/.data/kera.sqlite
```

Regeneration is pinned to the video's October 18 date. It does not silently advance or erase history.


## Jad, added October 18

Jad is the existing resident profile, not a duplicate: age 67, sex Other / prefer not to answer, conditions Dying, medications Everything, and recent changes Eczema found in groin area. These are user-supplied fictional scenario fields, not verified medical facts. No clinical sex or sex-specific reference range is inferred.

His 27 weekly dates from April 19 through October 18 contain 27 deliberately very low simulated Hb results (60.4 to 79.4 g/L) and 27 simulated Nail Health Analysis results with concerning descriptive observations in all four review categories. No picture was analyzed to create these records, and no diagnosis is established. The generator reproduces the added history, while the local backup preserves all previous results. A pre-change JSON workspace backup and consistent SQLite snapshot are kept under web/.data/before-jad-<timestamp>.
