app_name = "masar"
app_title = "Masar"
app_publisher = "Akwad Programming"
app_description = "Masar - agile work management (Spaces, Tasks, Features, Batches, Releases)"
app_email = "engineering@akwad.dev"
app_license = "Proprietary"

required_apps = []

# Masar runs beside the other apps of a Frappe / ERPNext site (client revision 4): people sign in with
# Frappe's own login page, find Masar on the Apps screen and open it at /masar. Nothing here changes the
# login page, the website, the Desk or other apps.
add_to_apps_screen = [
	{
		"name": "masar",
		"logo": "/assets/masar/images/masar-logo.svg",
		"title": "Masar",
		"route": "/masar",
		"has_permission": "masar.api.session.check_app_permission",
	}
]

# The Workspace is one page (www/masar.html, built from frontend/); every /masar/... path opens it.
website_route_rules = [{"from_route": "/masar/<path:app_path>", "to_route": "masar"}]
# Except its service worker (client revision 5), which must be served from /masar/ to control it.
page_renderer = ["masar.pwa.ServiceWorkerPage"]

after_install = "masar.install.after_install"
after_migrate = "masar.install.after_migrate"

# Row-level access is decided by Space membership (docs/04-security-permissions.md).
# Every hook returns an explicit bool: in Frappe v16 a None return denies.
has_permission = {
	"Masar Space": "masar.permissions.space_has_permission",
	"Masar Task": "masar.permissions.task_has_permission",
	"Masar Activity": "masar.permissions.activity_has_permission",
	"Masar Task Action": "masar.permissions.space_content_has_permission",
	"Masar Label": "masar.permissions.space_content_has_permission",
	"Masar Feature": "masar.permissions.space_content_has_permission",
	"Masar Release": "masar.permissions.space_content_has_permission",
	"Masar Batch": "masar.permissions.batch_has_permission",
	"Masar Batch Item": "masar.permissions.batch_item_has_permission",
	"Masar Comment": "masar.permissions.space_content_has_permission",
	"Masar Comment Reaction": "masar.permissions.space_content_has_permission",
	"Masar Attachment": "masar.permissions.space_content_has_permission",
	"Masar Space File": "masar.permissions.space_content_has_permission",
	"Masar Time Entry": "masar.permissions.space_content_has_permission",
	"Masar Comment Notification": "masar.permissions.notification_has_permission",
	"Masar Timer Session": "masar.permissions.timer_has_permission",
	"Masar My Day": "masar.permissions.my_day_has_permission",
	"Masar Notification": "masar.permissions.inbox_has_permission",
	"Masar Push Subscription": "masar.permissions.push_subscription_has_permission",
	# Frappe lets a file's uploader read it forever; Masar Task files follow Space membership (ADR-054).
	"File": "masar.permissions.file_has_permission",
}

permission_query_conditions = {
	"Masar Space": "masar.permissions.space_query_conditions",
	"Masar Task": "masar.permissions.task_query_conditions",
	"Masar Activity": "masar.permissions.activity_query_conditions",
	# Child tables can be listed directly (frappe.client.get_list with `parent`): filter them too.
	"Masar Space Member": "masar.permissions.space_member_query_conditions",
	"Masar Task Assignee": "masar.permissions.task_assignee_query_conditions",
	"Masar Task Action": "masar.permissions.task_action_query_conditions",
	"Masar Label": "masar.permissions.label_query_conditions",
	"Masar Task Label": "masar.permissions.task_label_query_conditions",
	"Masar Feature": "masar.permissions.feature_query_conditions",
	"Masar Release": "masar.permissions.release_query_conditions",
	"Masar Batch": "masar.permissions.batch_query_conditions",
	"Masar Batch Item": "masar.permissions.batch_item_query_conditions",
	"Masar Comment": "masar.permissions.comment_query_conditions",
	"Masar Comment Reaction": "masar.permissions.comment_reaction_query_conditions",
	"Masar Attachment": "masar.permissions.attachment_query_conditions",
	"Masar Space File": "masar.permissions.space_file_query_conditions",
	"Masar Timer Session": "masar.permissions.timer_query_conditions",
	"Masar My Day": "masar.permissions.my_day_query_conditions",
	"Masar Time Entry": "masar.permissions.time_entry_query_conditions",
	"Masar Comment Notification": "masar.permissions.notification_query_conditions",
	"Masar Notification": "masar.permissions.inbox_query_conditions",
	"Masar Push Subscription": "masar.permissions.push_subscription_query_conditions",
	"File": "masar.permissions.file_query_conditions",
}

extend_doctype_class = {
	"File": ["masar.overrides.file.MasarFileMixin"],
}

scheduler_events = {
	"daily": ["masar.services.attachment_service.cleanup_abandoned_uploads"],
	# Shortly after midnight in the site time zone (Asia/Qatar): unfinished Tasks past their due date.
	# Then each person's My Day starts afresh with the Tasks due today.
	"cron": {
		"5 0 * * *": [
			"masar.services.task_service.mark_overdue",
			"masar.services.personal.my_day_service.start_new_day",
		]
	},
}

doc_events = {
	# Document sharing would bypass Space filters ("shared docs trump all other restrictions").
	"DocShare": {"before_insert": "masar.permissions.block_masar_document_share"},
}
