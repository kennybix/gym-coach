from coach import energy


def test_tennis_kcal():
    # 2h tennis at 84 kg, MET 7 -> 7 * 84 * 2 = 1176
    assert energy.estimate_kcal("Tennis", 7200, None, 84) == 1176


def test_walking_beats_running_keyword():
    # "Walking, Treadmill" must be walking (3.5), not the running default
    assert energy.met_for("Walking, Treadmill") == 3.5


def test_treadmill_running_speed_derived():
    # 1287 m in 720 s -> ~6.4 km/h (≈4 mph) -> brisk band (5.0)
    assert energy.met_for("Running, Treadmill", 720, 1287) == 5.0
    # 2400 m in 720 s -> 12 km/h -> running band (11.5)
    assert energy.met_for("Running, Treadmill", 720, 2400) == 11.5


def test_yoga_is_low_intensity():
    assert energy.met_for("Yoga") == 2.8


def test_needs_duration_and_weight():
    assert energy.estimate_kcal("Tennis", None, None, 84) is None
    assert energy.estimate_kcal("Tennis", 7200, None, None) is None
