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


def test_zero_duration_gives_no_estimate():
    # duration of 0 must not compute a bogus 0-kcal number
    assert energy.estimate_kcal("Running", 0, 1000, 84) is None


def test_incline_raises_treadmill_kcal():
    # ACSM: grade increases the energy cost of the same distance/time
    flat = energy.estimate_kcal("Running, Treadmill", 480, 900, 84, 0)
    steep = energy.estimate_kcal("Running, Treadmill", 480, 900, 84, 8)
    assert flat and steep and steep > flat


def test_walk_with_distance_uses_acsm():
    # walking on a measured distance should produce a sensible positive estimate
    assert (energy.estimate_kcal("Walking", 1800, 3000, 84, 0) or 0) > 0


def test_strength_kcal_guards_and_monotonic():
    assert energy.strength_kcal(None, 3) is None     # no bodyweight -> no estimate
    assert energy.strength_kcal(84, 0) is None        # no sets -> no estimate
    one, five = energy.strength_kcal(84, 1), energy.strength_kcal(84, 5)
    assert one and five and five > one                # more sets -> more kcal (non-zero)
