from dms.setup.item_images import sync_item_images


def execute():
	"""Set Item images from dms/item_images/item_images.zip. Undo with dms.setup.item_images.rollback."""
	sync_item_images()
