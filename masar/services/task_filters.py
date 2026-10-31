"""Filter operators of the Task lists (specs/dynamic-task-filters.md).

Each filter chip is one field, one operator and its values: values of a chip are OR, chips are AND.
The conditions only narrow Tasks of Spaces the caller's query has already authorised; they read no
other records.
"""

import frappe
from frappe import _

IS, NOT, EMPTY, SET = "is", "not", "empty", "set"
# Required fields (status, priority) and the owner (every Task has one) have no "empty".
VALUE_OPERATORS = (IS, NOT)
SET_OPERATORS = (IS, NOT, EMPTY, SET)


def operator(value: str | None, allowed: tuple[str, ...]) -> str:
	"""The chip operator; an unknown or unsupported one is a validation error, never ignored."""
	chosen = value or IS
	if chosen not in allowed:
		frappe.throw(_("Unknown filter operator."))
	return chosen


def column_condition(field, values: list[str] | None, op: str):
	"""Condition on a Task column, or None when the chip doesn't filter (no values chosen).
	"is not" keeps Tasks without a value: an unowned Task is "not owned by Alaa"."""
	if op == EMPTY:
		return field.isnull()
	if op == SET:
		return field.isnotnull()
	if not values:
		return None
	return field.isin(values) if op == IS else (field.notin(values) | field.isnull())


def membership_condition(task, subquery, values: list[str] | None, op: str):
	"""Condition on a child table (assignees, labels). `subquery(values)` selects the parent Tasks
	linked to any of `values`, or to any value at all when `values` is None.
	"is not" excludes a Task linked to any chosen value."""
	if op == EMPTY:
		return task.name.notin(subquery(None))
	if op == SET:
		return task.name.isin(subquery(None))
	if not values:
		return None
	return task.name.isin(subquery(values)) if op == IS else task.name.notin(subquery(values))


def apply(query, condition):
	return query if condition is None else query.where(condition)
