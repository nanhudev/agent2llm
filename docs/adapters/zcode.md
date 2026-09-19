# ZCode

Status: unavailable for execution. Checked 2026-09-19.

The official [Desktop installation guide](https://zcode.z.ai/en/docs/install) and [Agent documentation](https://zcode.z.ai/en/docs/agents) describe project selection, model access and execution modes inside Desktop. They did not establish a supported external execution API in this review. No local ZCode installation was found in checked application locations.

The normal Harness registry includes ZCode so this limitation is visible. Presence checks never launch Desktop or private runtime files. `ZCODE_HOME` can identify its installation directory; this does not enable execution. Authentication stays unknown; workspace discovery returns null. Headless execution, structured output, permissions, model selection and session resume remain unverified.

No unofficial CLI or extracted Desktop runtime is installed or redistributed. A future executable integration needs a verified upstream contract and real execution tests before capabilities are enabled.
