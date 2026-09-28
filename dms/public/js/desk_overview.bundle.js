// Adds an "Overview" item to the Desktop page's avatar menu, linking to the DMS SPA.
// The Desktop page (bare /desk landing) builds its own avatar menu in desktop.js and
// exposes this document event as the supported extension point (see billing.bundle.js).
$(document).on("desktop_screen", function (event, data) {
	data.desktop.add_menu_item({
		label: __("Overview"),
		icon: "layout-grid",
		onClick: function () {
			window.location.href = "/dms";
		},
	});
});
