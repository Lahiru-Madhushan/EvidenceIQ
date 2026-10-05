# Information Retrieval and Security Assessment Results

## SEC-01 — Unauthenticated Retrieval Access

- **Objective:** Verify that unauthenticated users cannot search for papers.
- **Endpoint:** `POST /api/retrieval/search`
- **Test input:** Request submitted without an authorization token.
- **Expected result:** HTTP 401 Unauthorized.
- **Actual result:** HTTP 401 Unauthorized.
- **Status:** PASS.
- **Observation:** The API rejected the request because authentication credentials were not provided.
- **Conclusion:** The retrieval endpoint correctly prevents unauthenticated access.
- **Evidence:** `evidence/SEC-01-unauthenticated-retrieval.jpg`