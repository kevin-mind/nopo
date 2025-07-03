from django.test import TestCase, Client
from django.conf import settings
from bs4 import BeautifulSoup


class WebComponentsSSRTestCase(TestCase):
    """Test server-side rendering of web components."""

    def setUp(self):
        self.client = Client()

    def test_home_page_renders_web_components(self):
        """Test that the home page renders web components in the HTML."""
        # Use the correct URL based on SERVICE_PUBLIC_PATH
        base_path = f"{settings.SERVICE_PUBLIC_PATH.strip('/')}/"
        response = self.client.get(base_path)

        # Check that the response is successful
        self.assertEqual(response.status_code, 200)

        # Parse the HTML content
        soup = BeautifulSoup(response.content, "html.parser")

        # Verify the basic HTML structure
        self.assertIsNotNone(soup.find("html"))
        self.assertIsNotNone(soup.find("head"))
        self.assertIsNotNone(soup.find("body"))

        # Verify that web components are present in the HTML
        more_components = soup.find_all("more-component")
        self.assertGreaterEqual(
            len(more_components),
            1,
            "Should have at least one more-component in the HTML",
        )

        # Verify web component has default name attribute
        component_with_name = soup.find("more-component")
        self.assertIsNotNone(component_with_name)

        # Check if name attribute is present (defaults to "World")
        name_attr = component_with_name.get("name") if component_with_name else None
        if name_attr:
            self.assertEqual(name_attr, "World")

        # Verify component has count attribute (defaults to 0)
        count_attr = component_with_name.get("count") if component_with_name else None
        if count_attr:
            self.assertEqual(count_attr, "0")

    def test_web_components_have_proper_attributes(self):
        """Test that web components have the expected attributes."""
        base_path = f"{settings.SERVICE_PUBLIC_PATH.strip('/')}/"
        response = self.client.get(base_path)
        soup = BeautifulSoup(response.content, "html.parser")

        # Test component attributes
        more_component = soup.find("more-component")
        self.assertIsNotNone(more_component)

        if more_component:
            # Test that the component has the expected structure
            name_attr = more_component.get("name")
            count_attr = more_component.get("count")

            # Name should default to "World" if not explicitly set
            self.assertIn(name_attr or "World", ["World", None])

            # Count should default to "0" if not explicitly set
            self.assertIn(count_attr or "0", ["0", None])

    def test_vite_assets_are_included(self):
        """Test that Vite assets are properly included in the HTML."""
        base_path = f"{settings.SERVICE_PUBLIC_PATH.strip('/')}/"
        response = self.client.get(base_path)
        soup = BeautifulSoup(response.content, "html.parser")

        # In development mode, we should have vite client script
        # In production mode, we should have the built assets
        scripts = soup.find_all("script")
        self.assertGreater(len(scripts), 0, "Should have script tags in the HTML")

        # Look for either Vite dev server or production scripts
        has_vite_assets = any(
            script.get("src")
            and (
                "vite" in script.get("src", "")
                or "main-" in script.get("src", "")
                or "@vite/client" in script.get("src", "")
            )
            for script in scripts
        )

        self.assertTrue(has_vite_assets, "Should have Vite-related scripts in the HTML")

    def test_css_styles_are_present(self):
        """Test that CSS styles are included for proper styling."""
        base_path = f"{settings.SERVICE_PUBLIC_PATH.strip('/')}/"
        response = self.client.get(base_path)
        soup = BeautifulSoup(response.content, "html.parser")

        # Check for inline styles or CSS links
        style_tags = soup.find_all("style")
        link_tags = soup.find_all("link", {"rel": "stylesheet"})

        self.assertGreater(
            len(style_tags) + len(link_tags), 0, "Should have CSS styles in the HTML"
        )

        # Check that basic styling classes are present
        html_content = response.content.decode("utf-8")
        self.assertIn("container", html_content)
        self.assertIn("header", html_content)
        self.assertIn("content", html_content)

    def test_accessibility_attributes(self):
        """Test that the page has proper accessibility attributes."""
        base_path = f"{settings.SERVICE_PUBLIC_PATH.strip('/')}/"
        response = self.client.get(base_path)
        soup = BeautifulSoup(response.content, "html.parser")

        # Check for lang attribute
        html_tag = soup.find("html")
        self.assertIsNotNone(html_tag)
        if html_tag:
            self.assertEqual(html_tag.get("lang"), "en")

        # Check for viewport meta tag
        viewport_meta = soup.find("meta", {"name": "viewport"})
        self.assertIsNotNone(viewport_meta)
        if viewport_meta:
            self.assertIn("width=device-width", viewport_meta.get("content", ""))

        # Check for charset
        charset_meta = soup.find("meta", {"charset": True})
        self.assertIsNotNone(charset_meta)

    def test_component_content_structure(self):
        """Test that the component renders the expected content structure."""
        base_path = f"{settings.SERVICE_PUBLIC_PATH.strip('/')}/"
        response = self.client.get(base_path)
        html_content = response.content.decode("utf-8")

        # Check that the component content is present in the HTML
        # The component should render "Hello, World!" and "Click Count: 0"
        self.assertIn("Hello,", html_content)
        self.assertIn("Click Count:", html_content)

        # Check that the component custom element is registered
        self.assertIn("more-component", html_content)
