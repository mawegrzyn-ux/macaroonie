-- 161_feature_upvotes_user_text.sql
--
-- feature_request_upvotes.user_id was uuid, but the routes store and look up
-- the caller's Auth0 user id (req.user.sub, e.g. "google-oauth2|1234"),
-- which is never a uuid: every list of feature requests and every upvote
-- failed with "invalid input syntax for type uuid". Keep the Auth0 id as text.

ALTER TABLE feature_request_upvotes ALTER COLUMN user_id TYPE text USING user_id::text;
