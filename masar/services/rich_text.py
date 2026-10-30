"""Server-side sanitising of comment rich text (ADR-052).

The editor is not a security boundary: every comment is rebuilt from an allow-list with nh3 (Rust
ammonia). Stored representation: HTML limited to paragraphs, line breaks, bold, italic, strike, inline
code, lists, links (http/https/mailto, forced rel), mentions and images of the Task's own private
attachments. Everything else — scripts, event handlers, styles, iframes, unknown URL schemes — is removed.
"""

import re
from html import unescape

import frappe
import nh3
from frappe import _

MAX_INPUT = 100_000
MAX_STORED = 50_000
TAGS = {"p", "br", "strong", "b", "em", "i", "s", "code", "ul", "ol", "li", "a", "span", "img"}
ATTRIBUTES = {
	"a": {"href"},
	"span": {"data-type", "data-id", "data-label", "class"},
	"img": {"src", "alt"},
}
PRIVATE_FILE = re.compile(r"^/private/files/[^\s\"'<>?#]+$")


def sanitize_comment(html: str | None, *, members: set[str], image_urls: set[str]) -> tuple[str, list[str]]:
	"""Return (safe_html, mentioned_users). `members` are the users who may be mentioned (current
	members of the Task's Space); `image_urls` are the private file URLs this comment may embed.
	Raises ValidationError for empty or oversized content."""
	html = html or ""
	if len(html) > MAX_INPUT:
		frappe.throw(_("This comment is too long."))
	mentioned: list[str] = []

	def keep(tag: str, attribute: str, value: str) -> str | None:
		if tag == "span":
			if attribute == "data-type":
				return value if value == "mention" else None
			if attribute == "class":
				return "mention" if value == "mention" else None
			if attribute == "data-id":
				if value in members:
					if value not in mentioned:
						mentioned.append(value)
					return value
				return None  # forged or former member: the mention degrades to plain text
			return value  # data-label (escaped text)
		if tag == "img":
			if attribute == "src":
				return value if PRIVATE_FILE.match(value) and value in image_urls else None
			return value
		return value

	clean = nh3.clean(
		html,
		tags=TAGS,
		attributes=ATTRIBUTES,
		url_schemes={"http", "https", "mailto"},
		link_rel="noopener noreferrer nofollow",
		attribute_filter=keep,
		strip_comments=True,
		clean_content_tags={"script", "style"},
	)
	clean = re.sub(r"<img(?![^>]*\ssrc=)[^>]*>", "", clean)  # images whose source was rejected
	clean = clean.strip()
	if not has_content(clean):
		frappe.throw(_("A comment cannot be empty."))
	if len(clean) > MAX_STORED:
		frappe.throw(_("This comment is too long."))
	return clean, mentioned


def has_content(html: str) -> bool:
	return bool(plain_text(html)) or "<img" in html


def plain_text(html: str | None, limit: int | None = None) -> str:
	"""Text-only preview (emails, history), whitespace-collapsed."""
	text = " ".join(unescape(nh3.clean(html or "", tags=set())).split())
	if limit and len(text) > limit:
		return text[: limit - 1].rstrip() + "…"
	return text
