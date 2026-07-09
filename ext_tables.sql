#
# Additional columns on tt_content for the Hero Builder content element
#
CREATE TABLE tt_content (
    collages int(11) unsigned DEFAULT '0' NOT NULL,
    slider_autoplay tinyint(1) unsigned DEFAULT '0' NOT NULL,
    slider_interval int(11) unsigned DEFAULT '5000' NOT NULL,
    slider_loop tinyint(1) unsigned DEFAULT '1' NOT NULL,
    slider_controls tinyint(1) unsigned DEFAULT '1' NOT NULL,
    slider_indicators tinyint(1) unsigned DEFAULT '1' NOT NULL,
    slider_pause_hover tinyint(1) unsigned DEFAULT '1' NOT NULL,
    slider_effect varchar(16) DEFAULT 'slide' NOT NULL
);

#
# One collage = one slide. The per-breakpoint layer geometry lives in `composition` (JSON).
# Standard control/language/enable columns are added automatically from TCA ctrl.
#
CREATE TABLE tx_herobuilder_collage (
    content_uid int(11) unsigned DEFAULT '0' NOT NULL,
    title varchar(255) DEFAULT '' NOT NULL,
    link varchar(1024) DEFAULT '' NOT NULL,
    composition text,
    assets int(11) unsigned DEFAULT '0' NOT NULL
);

#
# Reusable composition templates (applied to a collage via the "Templates" gallery).
# Standard control/enable columns are added automatically from TCA ctrl.
#
CREATE TABLE tx_herobuilder_template (
    title varchar(255) DEFAULT '' NOT NULL,
    color varchar(7) DEFAULT '' NOT NULL,
    composition text
);
