# Future Enhancements

## Keep study and leader output synchronized

Separate `/bible --study` and `/bible --leader` requests are independent model generations, so their discussion questions may differ. A future version could preserve and reuse the exact participant study when producing a leader guide.

Possible design:

- Generate a study and assign it a short study ID.
- Cache the complete structured study result, including its questions, keyed by that ID and the normalized Bible reference.
- Allow leader mode to accept the study ID and ask the model only for suggested responses, follow-up prompts, facilitator notes, and a closing challenge based on the cached study.
- Render the cached participant content unchanged alongside the additional leader material, guaranteeing that answers remain aligned with the original questions.
- Define cache expiration, storage location, size limits, and behavior when an ID is missing or expired.
- Avoid including private participant responses or other sensitive discussion content in the cache.

A simpler interim workflow is to run leader mode first and treat its participant-study section as the source of truth for the group. The participant and leader portions are then produced in one generation and remain internally aligned.
