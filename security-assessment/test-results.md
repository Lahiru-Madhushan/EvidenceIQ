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

## SEC-02 — Invalid Authentication Token

- **Objective:** Verify that the retrieval endpoint rejects invalid authentication tokens.
- **Endpoint:** `POST /api/retrieval/search`
- **Test input:** Request submitted using `invalid-token-for-security-test`.
- **Expected result:** HTTP 401 Unauthorized.
- **Actual result:** HTTP 401 Unauthorized.
- **Status:** PASS.
- **Observation:** The API rejected the malformed authentication token.
- **Conclusion:** The retrieval endpoint validates tokens and prevents access with invalid credentials.
- **Evidence:** `evidence/SEC-02-invalid-token.jpg`

## SEC-03 — Review Access Control

- **Objective:** Verify that an authenticated user cannot access a nonexistent or unauthorized review.
- **Endpoint:** `POST /api/retrieval/search`
- **Expected:** HTTP 404 with a generic access-denied message.
- **Actual:** HTTP 404 — `Review not found or you do not have access to it.`
- **Result:** PASS
- **Security finding:** Review ownership validation prevents unauthorized access and reduces IDOR risk.
- **Evidence:** `evidence/SEC-03-review-access-control.png`

## SEC-04 — Malformed Review ID Validation

- **Objective:** Verify that the API rejects a malformed review identifier.
- **Endpoint:** `POST /api/retrieval/search`
- **Input:** `review_id` set to `not-a-valid-uuid`.
- **Expected:** HTTP 422 validation error.
- **Actual:** HTTP 422 validation error.
- **Result:** PASS
- **Security finding:** Strict UUID validation prevents malformed identifiers from reaching database queries.
- **Evidence:** `evidence/SEC-04-malformed-review-id.png`

## SEC-05 — Short Search Query Validation

- **Objective:** Verify that the API rejects a search query shorter than the permitted minimum length.
- **Endpoint:** `POST /api/retrieval/search`
- **Input:** `query` set to `a`.
- **Expected:** HTTP 422 validation error.
- **Actual:** HTTP 422 with `string_too_short` and the message `String should have at least 3 characters`.
- **Result:** PASS
- **Security finding:** Minimum-length validation prevents invalid search queries from reaching PubMed retrieval and database-processing logic.
- **Evidence:** `evidence/SEC-05-short-query-validation.png`

## SEC-06 — Maximum Results Limit Validation

- **Objective:** Verify that the API rejects requests exceeding the maximum permitted number of retrieval results.
- **Endpoint:** `POST /api/retrieval/search`
- **Input:** `max_results` set to `101`.
- **Expected:** HTTP 422 validation error because the maximum permitted value is 100.
- **Actual:** HTTP 422 with `less_than_equal` and the message `Input should be less than or equal to 100`.
- **Result:** PASS
- **Security finding:** The enforced result limit reduces the risk of resource-exhaustion and abusive requests causing excessive PubMed, network, or backend processing.
- **Evidence:** `evidence/SEC-06-maximum-results-limit.png`

## SEC-07 — Invalid Publication Year Range

- **Objective:** Verify that the API rejects a publication-year range in which the starting year is later than the ending year.
- **Endpoint:** `POST /api/retrieval/search`
- **Input:** `year_from` set to `2026` and `year_to` set to `2020`.
- **Expected:** HTTP 422 validation error.
- **Actual:** HTTP 422 with the message `year_from must be less than or equal to year_to`.
- **Result:** PASS
- **Security finding:** Logical year-range validation prevents invalid parameters from reaching PubMed and avoids unnecessary external-service and backend processing.
- **Evidence:** `evidence/SEC-07-invalid-year-range.png`

## SEC-08 — Page Size Limit Validation

- **Objective:** Verify that the API rejects requests exceeding the maximum permitted page size.
- **Endpoint:** `POST /api/retrieval/search`
- **Input:** `page_size` set to `51`.
- **Expected:** HTTP 422 validation error because the maximum permitted page size is 50.
- **Actual:** HTTP 422 with `less_than_equal` and the message `Input should be less than or equal to 50`.
- **Result:** PASS
- **Security finding:** Enforcing the page-size limit reduces the risk of oversized responses, resource exhaustion, and excessive PubMed or backend processing.
- **Evidence:** `evidence/SEC-08-page-size-limit.png`

## SEC-09 — Missing Required Query Validation

- **Objective:** Verify that the API rejects a retrieval request when the required search query is missing.
- **Endpoint:** `POST /api/retrieval/search`
- **Input:** The request body omitted the required `query` field.
- **Expected:** HTTP 422 validation error identifying `query` as required.
- **Actual:** HTTP 422 with `missing` and the message `Field required` for `body → query`.
- **Result:** PASS
- **Security finding:** Required-field validation prevents incomplete retrieval requests from reaching PubMed or database-processing logic.
- **Evidence:** `evidence/SEC-09-missing-query.png`

## SEC-10 — Unsupported HTTP Method Rejection

- **Objective:** Verify that the retrieval endpoint rejects unsupported HTTP methods.
- **Endpoint:** `GET /api/retrieval/search`
- **Input:** A GET request was sent to an endpoint that only permits POST requests.
- **Expected:** HTTP 405 with `Method Not Allowed`.
- **Actual:** HTTP 405 with the response `{"detail":"Method Not Allowed"}`.
- **Result:** PASS
- **Security finding:** Restricting the endpoint to its intended HTTP method reduces unintended API behaviour and prevents retrieval operations through unsupported request methods.
- **Evidence:** `evidence/SEC-10-method-not-allowed.png`

## SEC-11 — Invalid Page Number Validation

- **Objective:** Verify that the API rejects a page number below the minimum permitted value.
- **Endpoint:** `POST /api/retrieval/search`
- **Input:** `page` set to `0`.
- **Expected:** HTTP 422 validation error because pagination starts at page 1.
- **Actual:** HTTP 422 with `greater_than_equal` and the message `Input should be greater than or equal to 1`.
- **Result:** PASS
- **Security finding:** Minimum page-number validation prevents invalid pagination offsets and malformed retrieval requests from reaching PubMed or backend-processing logic.
- **Evidence:** `evidence/SEC-11-page-number-validation.png`


## SEC-12 — HTTP Security Headers Assessment

- **Objective:** Verify that the backend includes browser security headers in HTTP responses.
- **Endpoint:** `GET /docs`
- **Input:** A normal GET request was sent to the backend documentation endpoint.
- **Expected:** The response should include security headers protecting against MIME sniffing, clickjacking, referrer leakage, unrestricted browser permissions, and unsafe framing.
- **Actual:** HTTP 200 with `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`, and `Content-Security-Policy`.
- **Result:** PASS
- **Security finding:** The backend applies multiple defence-in-depth HTTP headers. These reduce exposure to clickjacking, MIME-type confusion, unwanted browser permissions, cross-origin window interaction, and unauthorized content loading.
- **Evidence:** `evidence/SEC-12-security-headers.png`

## SEC-13 — Untrusted CORS Origin Rejection

- **Objective:** Verify that the backend rejects cross-origin requests from an untrusted website.
- **Endpoint:** `OPTIONS /api/retrieval/search`
- **Input:** A CORS preflight request using the origin `https://evil.example`.
- **Expected:** HTTP 400 or another rejection response without an `Access-Control-Allow-Origin` header approving the untrusted origin.
- **Actual:** HTTP 400 Bad Request, and the response did not include `Access-Control-Allow-Origin: https://evil.example`.
- **Result:** PASS
- **Security finding:** The CORS configuration does not authorize the tested untrusted origin. This prevents a malicious website from reading authenticated retrieval responses through the victim’s browser.
- **Evidence:** `evidence/SEC-13-untrusted-cors-origin.png`


## SEC-14 — Trusted CORS Origin Allowed

- **Objective:** Verify that the legitimate EvidenceIQ frontend is permitted to access the backend through the configured CORS policy.
- **Endpoint:** `OPTIONS /api/retrieval/search`
- **Input:** A CORS preflight request using the trusted origin `http://localhost:5173`.
- **Expected:** HTTP 200 with `Access-Control-Allow-Origin: http://localhost:5173`.
- **Actual:** HTTP 200 with `Access-Control-Allow-Origin: http://localhost:5173` and `Access-Control-Allow-Credentials: true`.
- **Result:** PASS
- **Security finding:** The CORS policy correctly permits the configured EvidenceIQ frontend while SEC-13 confirms that an untrusted origin is rejected. This demonstrates origin allowlisting rather than unrestricted cross-origin access.
- **Evidence:** `evidence/SEC-14-trusted-cors-origin.png`


## SEC-15 — Server Technology Disclosure

- **Objective:** Determine whether backend responses disclose unnecessary server-technology information.
- **Endpoint:** `GET /docs`
- **Input:** A normal GET request was inspected for the HTTP `Server` response header.
- **Expected:** Production responses should avoid unnecessary disclosure of the underlying application-server technology.
- **Actual:** The response included `Server: uvicorn`.
- **Result:** FAIL — Low-risk information-disclosure finding.
- **Security finding:** The response reveals that Uvicorn is used as the application server. This does not directly compromise the system, but it assists technology fingerprinting and may help an attacker focus reconnaissance on server-specific weaknesses.
- **Recommendation:** Suppress the server banner in production through the ASGI server configuration or a reverse proxy, while retaining normal application logging internally.
- **Evidence:** `evidence/SEC-15-server-banner-disclosure.png`