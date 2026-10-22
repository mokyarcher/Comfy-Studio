from __future__ import annotations

from app import comfy_control_cooldown as cd


def setup_function() -> None:
    cd.reset_for_tests()


def test_shared_cooldown_independent_per_action() -> None:
    assert cd.check_allowed("interrupt")[0] is True
    left, until = cd.mark_used("interrupt", 90)
    assert left == 90
    assert until

    ok, rem, _ = cd.check_allowed("interrupt")
    assert ok is False
    assert rem >= 89

    # Other actions stay independent.
    assert cd.check_allowed("clear_queue")[0] is True
    assert cd.check_allowed("free")[0] is True

    snap = cd.status_snapshot(90)
    assert snap["cooldown_seconds"] == 90
    assert snap["actions"]["interrupt"]["remaining_seconds"] >= 89
    assert snap["actions"]["clear_queue"]["remaining_seconds"] == 0
